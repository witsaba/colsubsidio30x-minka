/**
 * `AuditorReview` island (REQ-AUD-1..5) — now over LIVE data.
 *
 * T22 tested this island against the eight seed fixtures it imported itself.
 * Task 5.5/5.6 changes that contract: the island fetches `GET /api/auditor/records`
 * on mount through an injected seam, owns loading/error/retry states, and writes
 * every auditor action PESSIMISTICALLY (design D7) — the trace line is drawn
 * only after `POST /api/auditor/actions` has returned 2xx, so a signature never
 * exists on screen without existing in `auditor_actions`.
 *
 * The fixtures survive as TEST DATA injected through the same seam, which is
 * why every behavioural assertion below is unchanged: the island's behaviour did
 * not change, only where its records come from.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { AuditorReview } from '../../../src/components/auditor/AuditorReview';
import {
  AUDITOR_NAME,
  AUDITOR_RECORDS,
  AUDITOR_WAREHOUSES,
  REVIEWED_WAREHOUSE_NAME,
} from '../../../src/fixtures/auditorSeed';
import type { AuditorActionInput, ExportDownload } from '../../../src/lib/api/operational';
import type { AuditorRecord } from '../../../src/lib/auditor/types';

/** Deterministic clock so trace assertions never depend on wall time. */
const clock = () => '9:05 a.m.';

/** A promise whose settlement the test controls — how pessimism is observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type ActionFn = (input: AuditorActionInput) => Promise<{ id: string; action: string }>;
type LoadFn = (planId: string, opts?: { signal?: AbortSignal }) => Promise<readonly AuditorRecord[]>;
type ExportFn = (input: { planId: string; auditorId: string }) => Promise<ExportDownload>;

const okAction: ActionFn = async () => ({ id: 'action-1', action: 'approve' });

/**
 * Mounts the island with the seed records served through the fetch seam and
 * waits for the list to appear, so every test starts from a loaded dashboard.
 */
const setup = async (props: Record<string, unknown> = {}) => {
  const view = render(
    <AuditorReview
      planId="plan-1"
      auditorId="auditor-1"
      warehouses={AUDITOR_WAREHOUSES}
      auditorName={AUDITOR_NAME}
      clock={clock}
      loadRecords={async () => AUDITOR_RECORDS}
      submitAction={okAction}
      {...props}
    />,
  );
  await screen.findByRole('list', { name: 'Registros' });
  return view;
};

/** Selects a record row by its article name. */
const selectRecord = (articulo: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(articulo, 'i') }));
};

const detail = () => screen.getByRole('complementary', { name: 'Registro seleccionado' });
const recordList = () => screen.getByRole('list', { name: 'Registros' });
const rows = () => within(recordList()).getAllByRole('listitem');
const traceEntries = () =>
  within(within(detail()).getByRole('list', { name: 'Decisiones del auditor' })).getAllByRole(
    'listitem',
  );

describe('REQ-AUD-3 — live fetch on mount, with loading and error states', () => {
  it('shows a loading status while the records request is in flight', async () => {
    const gate = deferred<readonly AuditorRecord[]>();
    render(
      <AuditorReview
        planId="plan-1"
        auditorId="auditor-1"
        warehouses={AUDITOR_WAREHOUSES}
        clock={clock}
        loadRecords={() => gate.promise}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Cargando los registros');
    // The list must not exist yet: an empty list would claim "nothing counted".
    expect(screen.queryByRole('list', { name: 'Registros' })).toBeNull();

    gate.resolve(AUDITOR_RECORDS);
    expect((await screen.findByRole('list', { name: 'Registros' })).isConnected).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks for the records of the plan it was given, exactly once', async () => {
    const loadRecords = vi.fn<LoadFn>(async () => AUDITOR_RECORDS);
    await setup({ planId: 'plan-77', loadRecords });

    expect(loadRecords).toHaveBeenCalledTimes(1);
    expect(loadRecords.mock.calls[0]?.[0]).toBe('plan-77');
  });

  it('renders the records the loader returned, never a built-in fixture set', async () => {
    const [first] = AUDITOR_RECORDS;
    const only: readonly AuditorRecord[] = [{ ...first!, id: 'live-1', articulo: 'ARROZ BLANCO 500G' }];

    await setup({ loadRecords: async () => only });

    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    expect(rows()).toHaveLength(1);
    expect(within(recordList()).getByText('ARROZ BLANCO 500G')).toBeTruthy();
    expect(within(recordList()).queryByText('ACEITE DE OLIVA EXTRA VIRGEN 500ML')).toBeNull();
  });

  it('shows an error with a retry — never an empty list — when the fetch fails', async () => {
    const loadRecords = vi
      .fn<LoadFn>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(AUDITOR_RECORDS);

    render(
      <AuditorReview
        planId="plan-1"
        auditorId="auditor-1"
        warehouses={AUDITOR_WAREHOUSES}
        clock={clock}
        loadRecords={loadRecords}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No pudimos cargar los registros');
    expect(screen.queryByRole('list', { name: 'Registros' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('list', { name: 'Registros' })).toBeTruthy();
    expect(loadRecords).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(3);
  });

  it('reports a missing plan instead of fetching with an empty id', async () => {
    const loadRecords = vi.fn<LoadFn>(async () => AUDITOR_RECORDS);
    render(<AuditorReview planId="" auditorId="auditor-1" clock={clock} loadRecords={loadRecords} />);

    expect(screen.getByRole('alert').textContent).toContain('Falta el plan');
    expect(loadRecords).not.toHaveBeenCalled();
  });
});

describe('REQ-AUD-3 — filter chips', () => {
  it('opens on "Requieren mirada · 3" and shows exactly the 3 alerted records', async () => {
    await setup();

    const chip = screen.getByRole('button', { name: 'Requieren mirada · 3' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(3);

    for (const articulo of [
      'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
      'GASEOSA PERSONAL 400ML',
      'SALSA DE SOYA 1L',
    ]) {
      expect(within(recordList()).getByText(articulo)).toBeTruthy();
    }
  });

  it('"Todos los registros" shows all 8 and "Verificados" starts empty', async () => {
    await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    expect(rows()).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: 'Verificados' }));
    expect(screen.queryAllByRole('listitem', { name: /MP-/ })).toHaveLength(0);
    expect(screen.getByText('Ningún registro en este filtro.')).toBeTruthy();
  });

  it('marks the pressed chip with aria-pressed — the design has zero aria', async () => {
    await setup();
    const todos = screen.getByRole('button', { name: 'Todos los registros' });
    expect(todos.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(todos);
    expect(todos.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the designed badge for each record', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));

    for (const label of ['Unidad', 'Cantidad atípica', 'Saldo negativo', 'Búsqueda manual']) {
      expect(within(recordList()).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(recordList()).getAllByText('Sin novedad')).toHaveLength(4);
  });
});

describe('REQ-AUD-2 — the auditor MAY see theoretical stock', () => {
  it('shows Contado and Sistema side by side for the 900 g / 4 L record', async () => {
    await setup();
    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');

    const pane = within(detail());
    expect(pane.getByText('Contado')).toBeTruthy();
    expect(pane.getByText('Sistema')).toBeTruthy();
    expect(pane.getByText('900')).toBeTruthy();
    expect(pane.getByText('4')).toBeTruthy();
    expect(pane.getByText('Unidad distinta')).toBeTruthy();
  });

  it('reads "Sin diferencia" when counted and system agree', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    selectRecord('PECHUGA POLLO FILETE X 180G');

    expect(within(detail()).getByText('Sin diferencia')).toBeTruthy();
  });
});

describe('REQ-AUD-4 — RF-32 trace and signed actions', () => {
  it('renders the six trace rows as a real table', async () => {
    await setup();
    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');

    const table = within(detail()).getByRole('table', { name: 'Traza del registro' });
    for (const label of [
      'Contado por',
      'Hora del registro',
      'Plan',
      'Lo que se dictó',
      'Consenso de modelos',
      'Estado',
    ]) {
      expect(within(table).getByRole('rowheader', { name: label })).toBeTruthy();
    }
    expect(within(table).getByText('Pablo R.')).toBeTruthy();
    expect(within(table).getByText('3 de 3')).toBeTruthy();
  });

  it('states that every action is signed', async () => {
    await setup();
    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    expect(
      within(detail()).getByText('Toda acción queda firmada con usuario, hora y motivo.'),
    ).toBeTruthy();
  });

  it('"Aprobar registro" verifies the record, decrements the pill and leaves a trace', async () => {
    await setup();
    expect(screen.getByText('3 alertas abiertas')).toBeTruthy();

    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));

    await waitFor(() => expect(screen.getByText('2 alertas abiertas')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Requieren mirada · 2' })).toBeTruthy();
    expect(within(detail()).getByText('Verificado')).toBeTruthy();

    const entry = traceEntries()[0];
    expect(entry?.textContent).toContain('Viviana Ríos');
    expect(entry?.textContent).toContain('9:05 a.m.');
    expect(entry?.textContent).toContain('Aprobó el registro');
  });

  it('sends the approval to /api/auditor/actions with the auditor and record ids', async () => {
    const submitAction = vi.fn<ActionFn>(okAction);
    await setup({ submitAction });

    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));

    await waitFor(() => expect(submitAction).toHaveBeenCalledTimes(1));
    expect(submitAction.mock.calls[0]?.[0]).toMatchObject({
      auditorId: 'auditor-1',
      recordId: 'aud-1',
      action: 'approve',
    });
  });

  /* ------------------------------------------------------------------- D7 */

  it('draws NO trace entry until the action write has returned 2xx', async () => {
    const gate = deferred<{ id: string; action: string }>();
    await setup({ submitAction: () => gate.promise });

    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));

    // In flight: nothing signed on screen, nothing verified, pill untouched.
    expect(
      within(detail()).queryByRole('list', { name: 'Decisiones del auditor' }),
    ).toBeNull();
    expect(screen.getByText('3 alertas abiertas')).toBeTruthy();
    expect(within(detail()).queryByText('Verificado')).toBeNull();

    gate.resolve({ id: 'action-1', action: 'approve' });

    await waitFor(() => expect(traceEntries()[0]?.textContent).toContain('Aprobó el registro'));
    expect(screen.getByText('2 alertas abiertas')).toBeTruthy();
  });

  it('leaves the record untouched and explains itself when the action write fails', async () => {
    await setup({ submitAction: async () => Promise.reject(new Error('500')) });

    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No pudimos guardar la acción');

    expect(within(detail()).queryByRole('list', { name: 'Decisiones del auditor' })).toBeNull();
    expect(within(detail()).queryByText('Verificado')).toBeNull();
    expect(screen.getByText('3 alertas abiertas')).toBeTruthy();
  });

  it('"Corregir" saves a signed correction with its reason', async () => {
    const submitAction = vi.fn<ActionFn>(okAction);
    await setup({ submitAction });
    selectRecord('GASEOSA PERSONAL 400ML');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir' }));

    const dialog = screen.getByRole('dialog', { name: 'Corregir la cantidad' });
    expect(
      within(dialog).getByText(
        'La corrección del auditor queda firmada con su usuario y la hora, junto al valor que dictó el contador. El registro original nunca se borra.',
      ),
    ).toBeTruthy();

    fireEvent.input(within(dialog).getByLabelText('Cantidad corregida'), {
      target: { value: '30' },
    });
    fireEvent.input(within(dialog).getByLabelText('Motivo'), {
      target: { value: 'Reconteo en sitio' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar corrección' }));

    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => expect(within(detail()).getByText('30')).toBeTruthy());
    expect(traceEntries()[0]?.textContent).toContain('Corrigió la cantidad');
    expect(traceEntries()[0]?.textContent).toContain('Reconteo en sitio');

    expect(submitAction.mock.calls[0]?.[0]).toMatchObject({
      action: 'correct',
      recordId: 'aud-2',
      newQuantity: 30,
      note: 'Reconteo en sitio',
    });
  });

  it('"Pedir reconteo" leaves a signed request without verifying the record', async () => {
    const submitAction = vi.fn<ActionFn>(okAction);
    await setup({ submitAction });
    selectRecord('GASEOSA PERSONAL 400ML');
    fireEvent.click(screen.getByRole('button', { name: 'Pedir reconteo' }));

    const dialog = screen.getByRole('dialog', { name: 'Pedir reconteo de este artículo' });
    expect(
      within(dialog).getByText(
        'Le llega al contador de la bodega como tarea puntual: solo ese artículo, sin repetir las 107 líneas.',
      ),
    ).toBeTruthy();

    fireEvent.input(within(dialog).getByLabelText('Motivo'), {
      target: { value: 'Cantidad 10x sobre el rango' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar solicitud' }));

    await waitFor(() => expect(traceEntries()[0]?.textContent).toContain('Pidió reconteo'));
    // The alert stays open: asking for a recount does not settle the record.
    expect(screen.getByText('3 alertas abiertas')).toBeTruthy();
    expect(submitAction.mock.calls[0]?.[0]).toMatchObject({ action: 'request_recount' });
  });
});

describe('REQ-AUD-5 — export gate and the corrected blocked modal', () => {
  it('renders "Exportar a Oracle" disabled while alerts are open', async () => {
    await setup();
    expect(
      screen.getByRole('button', { name: 'Exportar a Oracle' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('shows the blocked modal, and NO control claims to export', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));

    const dialog = screen.getByRole('dialog', { name: 'Faltan 3 registros por resolver' });
    expect(
      within(dialog).getByText(
        'El archivo para Oracle se genera cuando ninguna alerta queda abierta. Así nadie carga un dato que después toca corregir a mano.',
      ),
    ).toBeTruthy();

    // The prototype wired a cancel button labelled "Exportar de todos modos"
    // that did nothing. A control must never claim an action it will not do.
    expect(screen.queryByText('Exportar de todos modos')).toBeNull();
    for (const control of within(dialog).getAllByRole('button')) {
      expect(control.textContent ?? '').not.toMatch(/exportar/i);
    }
  });

  it('"Ver los pendientes" closes the modal and filters to the pending list', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver los pendientes' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Requieren mirada · 3' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(rows()).toHaveLength(3);
  });

  it('"Cancelar" dismisses the blocked modal without changing the filter', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rows()).toHaveLength(8);
  });

  it('lifts the gate and opens the export modal once no alert is open', async () => {
    await setup({ strictExport: true });

    for (const articulo of [
      'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
      'GASEOSA PERSONAL 400ML',
      'SALSA DE SOYA 1L',
    ]) {
      selectRecord(articulo);
      fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));
      await waitFor(() => expect(within(detail()).getByText('Verificado')).toBeTruthy());
    }

    expect(screen.getByText('Sin alertas abiertas')).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: 'Exportar a Oracle' });
    expect(exportButton.getAttribute('aria-disabled')).toBe('false');

    fireEvent.click(exportButton);
    const dialog = screen.getByRole('dialog', { name: 'Generar archivo de carga' });
    expect(within(dialog).getByRole('button', { name: 'Generar y descargar' })).toBeTruthy();
  });

  it('never gates the export when strictExport is off', async () => {
    await setup({ strictExport: false });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    expect(screen.getByRole('dialog', { name: 'Generar archivo de carga' })).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Task 5.10 — the export button performs a REAL export (REQ-AUD-5, REQ-OE-2)  */
/* -------------------------------------------------------------------------- */

const DOWNLOAD = {
  filename: 'EXP-plan-1.csv',
  batchId: 'batch-1',
  csv: 'subinventory,item,count_qty,uom,counter\nBOD-1,MP-1,3,und,OP.001\n',
};

describe('REQ-OE-2 — "Generar y descargar" runs the real export', () => {
  it('posts the export and hands the returned file to the saver', async () => {
    const runExport = vi.fn<ExportFn>(async () => DOWNLOAD);
    const saveFile = vi.fn();
    await setup({ strictExport: false, runExport, saveFile });

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar y descargar' }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(runExport.mock.calls[0]?.[0]).toEqual({ planId: 'plan-1', auditorId: 'auditor-1' });
    expect(saveFile.mock.calls[0]?.[0]).toEqual(DOWNLOAD);
  });

  it('keeps the modal open and saves nothing while the export is in flight', async () => {
    const gate = deferred<typeof DOWNLOAD>();
    const saveFile = vi.fn();
    await setup({ strictExport: false, runExport: () => gate.promise, saveFile });

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar y descargar' }));

    expect(saveFile).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Generar archivo de carga' })).toBeTruthy();

    gate.resolve(DOWNLOAD);
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports the failure and offers NO file when the export write fails', async () => {
    const saveFile = vi.fn();
    await setup({
      strictExport: false,
      runExport: async () => Promise.reject(new Error('no batch')),
      saveFile,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar y descargar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No pudimos generar el archivo');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('never runs an export while the gate is closed', async () => {
    const runExport = vi.fn<ExportFn>(async () => DOWNLOAD);
    await setup({ strictExport: true, runExport });

    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver los pendientes' }));

    expect(runExport).not.toHaveBeenCalled();
  });
});

describe('accessibility the prototype lacks entirely', () => {
  it('gives every modal role=dialog, aria-modal and an accessible name', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('moves focus into the modal and closes it on Escape', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the modal', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));

    const dialog = screen.getByRole('dialog');
    const controls = within(dialog).getAllByRole('button');
    const last = controls[controls.length - 1];
    last?.focus();

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(controls[0]);

    controls[0]?.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('marks the selected warehouse and record with aria-current', async () => {
    await setup();

    const warehouses = screen.getByRole('list', { name: 'Bodegas' });
    const current = within(warehouses).getAllByRole('button', { current: true });
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain(REVIEWED_WAREHOUSE_NAME);

    selectRecord('SALSA DE SOYA 1L');
    expect(within(recordList()).getAllByRole('button', { current: true })).toHaveLength(1);
  });

  it('announces the warehouse pane header', async () => {
    await setup();
    expect(screen.getByText('Bodegas · 5 de 8 cerradas')).toBeTruthy();
  });
});

/**
 * T22 RED — the `AuditorReview` island (REQ-AUD-1..5).
 *
 * This is the only interactive surface of the dashboard: selection, filters,
 * the three signed actions, the trace, the four modals and the export gate are
 * one connected local-state tree (design §5), so they are tested together
 * through the island's public behaviour rather than per child component.
 */
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { AuditorReview } from '../../../src/components/auditor/AuditorReview';
import { REVIEWED_WAREHOUSE_NAME } from '../../../src/fixtures/auditorSeed';

/** Deterministic clock so trace assertions never depend on wall time. */
const clock = () => '9:05 a.m.';

const setup = (props: Record<string, unknown> = {}) =>
  render(<AuditorReview clock={clock} {...props} />);

/** Selects a record row by its article name. */
const selectRecord = (articulo: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(articulo, 'i') }));
};

const detail = () => screen.getByRole('complementary', { name: 'Registro seleccionado' });
const recordList = () => screen.getByRole('list', { name: 'Registros' });
const rows = () => within(recordList()).getAllByRole('listitem');

describe('REQ-AUD-3 — filter chips', () => {
  it('opens on "Requieren mirada · 3" and shows exactly the 3 alerted records', () => {
    setup();

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

  it('"Todos los registros" shows all 8 and "Verificados" starts empty', () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    expect(rows()).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: 'Verificados' }));
    expect(screen.queryAllByRole('listitem', { name: /MP-/ })).toHaveLength(0);
    expect(screen.getByText('Ningún registro en este filtro.')).toBeTruthy();
  });

  it('marks the pressed chip with aria-pressed — the design has zero aria', () => {
    setup();
    const todos = screen.getByRole('button', { name: 'Todos los registros' });
    expect(todos.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(todos);
    expect(todos.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the designed badge for each record', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));

    for (const label of ['Unidad', 'Cantidad atípica', 'Saldo negativo', 'Búsqueda manual']) {
      expect(within(recordList()).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(recordList()).getAllByText('Sin novedad')).toHaveLength(4);
  });
});

describe('REQ-AUD-2 — the auditor MAY see theoretical stock', () => {
  it('shows Contado and Sistema side by side for the 900 g / 4 L record', () => {
    setup();
    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');

    const pane = within(detail());
    expect(pane.getByText('Contado')).toBeTruthy();
    expect(pane.getByText('Sistema')).toBeTruthy();
    expect(pane.getByText('900')).toBeTruthy();
    expect(pane.getByText('4')).toBeTruthy();
    expect(pane.getByText('Unidad distinta')).toBeTruthy();
  });

  it('reads "Sin diferencia" when counted and system agree', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    selectRecord('PECHUGA POLLO FILETE X 180G');

    expect(within(detail()).getByText('Sin diferencia')).toBeTruthy();
  });
});

describe('REQ-AUD-4 — RF-32 trace and signed actions', () => {
  it('renders the six trace rows as a real table', () => {
    setup();
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

  it('states that every action is signed', () => {
    setup();
    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    expect(
      within(detail()).getByText('Toda acción queda firmada con usuario, hora y motivo.'),
    ).toBeTruthy();
  });

  it('"Aprobar registro" verifies the record, decrements the pill and leaves a trace', () => {
    setup();
    expect(screen.getByText('3 alertas abiertas')).toBeTruthy();

    selectRecord('ACEITE DE OLIVA EXTRA VIRGEN 500ML');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));

    expect(screen.getByText('2 alertas abiertas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Requieren mirada · 2' })).toBeTruthy();

    const pane = within(detail());
    expect(pane.getByText('Verificado')).toBeTruthy();

    const trace = pane.getByRole('list', { name: 'Decisiones del auditor' });
    const entry = within(trace).getAllByRole('listitem')[0];
    expect(entry?.textContent).toContain('Viviana Ríos');
    expect(entry?.textContent).toContain('9:05 a.m.');
    expect(entry?.textContent).toContain('Aprobó el registro');
  });

  it('"Corregir" saves a signed correction with its reason', () => {
    setup();
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

    const pane = within(detail());
    expect(pane.getByText('30')).toBeTruthy();
    const trace = within(pane.getByRole('list', { name: 'Decisiones del auditor' }));
    expect(trace.getAllByRole('listitem')[0]?.textContent).toContain('Corrigió la cantidad');
    expect(trace.getAllByRole('listitem')[0]?.textContent).toContain('Reconteo en sitio');
  });

  it('"Pedir reconteo" leaves a signed request without verifying the record', () => {
    setup();
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

    // The alert stays open: asking for a recount does not settle the record.
    expect(screen.getByText('3 alertas abiertas')).toBeTruthy();
    const trace = within(within(detail()).getByRole('list', { name: 'Decisiones del auditor' }));
    expect(trace.getAllByRole('listitem')[0]?.textContent).toContain('Pidió reconteo');
  });
});

describe('REQ-AUD-5 — export gate and the corrected blocked modal', () => {
  it('renders "Exportar a Oracle" disabled while alerts are open', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Exportar a Oracle' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the blocked modal, and NO control claims to export', () => {
    setup();
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

  it('"Ver los pendientes" closes the modal and filters to the pending list', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver los pendientes' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Requieren mirada · 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(3);
  });

  it('"Cancelar" dismisses the blocked modal without changing the filter', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Todos los registros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rows()).toHaveLength(8);
  });

  it('lifts the gate and opens the export modal once no alert is open', () => {
    setup({ strictExport: true });

    for (const articulo of [
      'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
      'GASEOSA PERSONAL 400ML',
      'SALSA DE SOYA 1L',
    ]) {
      selectRecord(articulo);
      fireEvent.click(screen.getByRole('button', { name: 'Aprobar registro' }));
    }

    expect(screen.getByText('Sin alertas abiertas')).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: 'Exportar a Oracle' });
    expect(exportButton.getAttribute('aria-disabled')).toBe('false');

    fireEvent.click(exportButton);
    const dialog = screen.getByRole('dialog', { name: 'Generar archivo de carga' });
    expect(within(dialog).getByRole('button', { name: 'Generar y descargar' })).toBeTruthy();
  });

  it('never gates the export when strictExport is off', () => {
    setup({ strictExport: false });
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));
    expect(screen.getByRole('dialog', { name: 'Generar archivo de carga' })).toBeTruthy();
  });
});

describe('accessibility the prototype lacks entirely', () => {
  it('gives every modal role=dialog, aria-modal and an accessible name', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('moves focus into the modal and closes it on Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Oracle' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the modal', () => {
    setup();
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

  it('marks the selected warehouse and record with aria-current', () => {
    setup();

    const warehouses = screen.getByRole('list', { name: 'Bodegas' });
    const current = within(warehouses).getAllByRole('button', { current: true });
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain(REVIEWED_WAREHOUSE_NAME);

    selectRecord('SALSA DE SOYA 1L');
    expect(within(recordList()).getAllByRole('button', { current: true })).toHaveLength(1);
  });

  it('announces the warehouse pane header', () => {
    setup();
    expect(screen.getByText('Bodegas · 5 de 8 cerradas')).toBeTruthy();
  });
});

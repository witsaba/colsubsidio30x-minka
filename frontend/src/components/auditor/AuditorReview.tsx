/**
 * `AuditorReview` — the single `/auditor` island (design §5, REQ-AUD-1..5).
 *
 * Selection, filters, the three signed actions, the trace and the export gate
 * are one connected local-state tree, so they live in one island rather than
 * four coordinating ones. `close` and `base` stay static `.astro`.
 *
 * DATA SOURCE: the seeded fixtures. The live operator->auditor handoff is
 * explicitly stretch (S4), so this island holds its own working copy of the
 * records and never fetches.
 *
 * CORRECTED DESIGN BUG (REQ-AUD-5): the prototype's `blocked` modal is wired
 * backwards — its cancel control is labelled "Exportar de todos modos" but does
 * nothing, while the confirm control navigates. A control must never claim an
 * action it will not perform, and here the false claim is about the exact thing
 * the gate exists to prevent. The affordance is REMOVED: the modal offers
 * "Cancelar" and "Ver los pendientes", and no control anywhere in it mentions
 * exporting.
 */
import { useMemo, useState } from 'preact/hooks';

import type { AuditorRecord, TraceEntry, Warehouse } from '../../fixtures/auditorSeed';
import {
  AUDITOR_EYEBROW,
  AUDITOR_NAME,
  AUDITOR_RECORDS,
  AUDITOR_WAREHOUSES,
  isOpenAlert,
  openAlertCount,
} from '../../fixtures/auditorSeed';
import { DetailPane } from './DetailPane';
import { Modal } from './Modal';
import type { RecordFilter } from './RecordList';
import { RecordList } from './RecordList';
import { WarehouseList } from './WarehouseList';

type ModalKind = 'blocked' | 'export' | 'correct' | 'recount';

export interface AuditorReviewProps {
  records?: readonly AuditorRecord[];
  warehouses?: readonly Warehouse[];
  /** Gates the export while any alert is open. Default `true`. */
  strictExport?: boolean;
  auditorName?: string;
  /** Injected so trace timestamps are deterministic under test. */
  clock?: () => string;
}

/** Verbatim modal copy (design contract §3 "Modals"). */
const MODAL_BODY = {
  blocked:
    'El archivo para Oracle se genera cuando ninguna alerta queda abierta. Así nadie carga un dato que después toca corregir a mano.',
  export:
    '1.482 registros verificados de 8 bodegas, en formato Import Count Sequences. Se descarga junto al reporte de conciliación y la traza de cada registro.',
  correct:
    'La corrección del auditor queda firmada con su usuario y la hora, junto al valor que dictó el contador. El registro original nunca se borra.',
  recount:
    'Le llega al contador de la bodega como tarea puntual: solo ese artículo, sin repetir las 107 líneas.',
} as const;

const defaultClock = (): string =>
  new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });

export function AuditorReview({
  records: seedRecords = AUDITOR_RECORDS,
  warehouses = AUDITOR_WAREHOUSES,
  strictExport = true,
  auditorName = AUDITOR_NAME,
  clock = defaultClock,
}: AuditorReviewProps) {
  const [records, setRecords] = useState<readonly AuditorRecord[]>(seedRecords);
  const [selectedId, setSelectedId] = useState<string | null>(seedRecords[0]?.id ?? null);
  const [warehouseId, setWarehouseId] = useState<string>(
    warehouses.find((w) => w.selected)?.id ?? warehouses[0]?.id ?? '',
  );
  const [filter, setFilter] = useState<RecordFilter>('mirada');
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [correction, setCorrection] = useState('');
  const [reason, setReason] = useState('');

  const openAlerts = openAlertCount(records);
  const closedCount = warehouses.filter((w) => w.state === 'cerrada').length;
  const selected = records.find((record) => record.id === selectedId) ?? null;

  const visible = useMemo(() => {
    if (filter === 'mirada') return records.filter(isOpenAlert);
    if (filter === 'verificados') return records.filter((record) => record.verified);
    return records;
  }, [records, filter]);

  /** Every auditor action appends one signed line — RF-32, REQ-AUD-4. */
  const sign = (
    action: string,
    options: { verify?: boolean; quantity?: string; reason?: string } = {},
  ) => {
    if (selected === null) return;
    const entry: TraceEntry = {
      user: auditorName,
      time: clock(),
      action,
      ...(options.reason !== undefined && options.reason !== '' ? { reason: options.reason } : {}),
    };

    setRecords((current) =>
      current.map((record) =>
        record.id === selected.id
          ? {
              ...record,
              verified: options.verify === true ? true : record.verified,
              counted:
                options.quantity === undefined
                  ? record.counted
                  : { ...record.counted, quantity: options.quantity },
              // Newest first: the auditor reads the latest decision, not the log.
              trace: [entry, ...record.trace],
            }
          : record,
      ),
    );
  };

  const closeModal = () => {
    setModal(null);
    setCorrection('');
    setReason('');
  };

  const onExport = () => {
    // The gate is the honest behaviour: with alerts open there is no export
    // path at all, only an explanation and a way to reach the pending records.
    setModal(strictExport && openAlerts > 0 ? 'blocked' : 'export');
  };

  const headerTitle = `${warehouses.find((w) => w.id === warehouseId)?.name ?? ''} · revisión`;

  return (
    <div class="review">
      <header class="review__head">
        <div>
          <p class="review__eyebrow">{AUDITOR_EYEBROW}</p>
          <h1 class="review__title">{headerTitle}</h1>
        </div>

        <div class="review__actions">
          <p class={`pill pill--${openAlerts > 0 ? 'warn' : 'ok'}`}>
            <span class="pill__icon" aria-hidden="true">
              {openAlerts > 0 ? 'error' : 'task_alt'}
            </span>
            {openAlerts > 0 ? `${openAlerts} alertas abiertas` : 'Sin alertas abiertas'}
          </p>

          {/*
            `aria-disabled` rather than the native `disabled` attribute: a native
            disabled button cannot be focused or activated, so it can never tell
            the auditor WHY the export is unavailable. The blocked modal is that
            explanation, and REQ-AUD-5 requires activating export to show it.
          */}
          <button
            type="button"
            class="btn btn--primary btn--export"
            aria-disabled={strictExport && openAlerts > 0 ? 'true' : 'false'}
            onClick={onExport}
          >
            <span class="btn__icon" aria-hidden="true">
              ios_share
            </span>
            Exportar a Oracle
          </button>
        </div>
      </header>

      <div class="review__panes">
        <aside class="review__bodegas" aria-label="Bodegas">
          <WarehouseList
            warehouses={warehouses}
            selectedId={warehouseId}
            onSelect={setWarehouseId}
            closedCount={closedCount}
          />
        </aside>

        <main class="review__registros">
          <RecordList
            records={records}
            visible={visible}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </main>

        <aside class="review__detalle" aria-label="Registro seleccionado">
          <DetailPane
            record={selected}
            onApprove={() => sign('Aprobó el registro', { verify: true })}
            onCorrect={() => {
              setCorrection(selected?.counted.quantity ?? '');
              setModal('correct');
            }}
            onRecount={() => setModal('recount')}
          />
        </aside>
      </div>

      {modal === 'blocked' ? (
        <Modal
          icon="error"
          tone="warn"
          title={`Faltan ${openAlerts} registros por resolver`}
          body={MODAL_BODY.blocked}
          cancelLabel="Cancelar"
          confirmLabel="Ver los pendientes"
          onCancel={closeModal}
          onConfirm={() => {
            setFilter('mirada');
            closeModal();
          }}
        />
      ) : null}

      {modal === 'export' ? (
        <Modal
          icon="ios_share"
          tone="info"
          title="Generar archivo de carga"
          body={MODAL_BODY.export}
          cancelLabel="Cancelar"
          confirmLabel="Generar y descargar"
          onCancel={closeModal}
          onConfirm={closeModal}
        />
      ) : null}

      {modal === 'correct' ? (
        <Modal
          icon="edit"
          tone="info"
          title="Corregir la cantidad"
          body={MODAL_BODY.correct}
          cancelLabel="Cancelar"
          confirmLabel="Guardar corrección"
          onCancel={closeModal}
          onConfirm={() => {
            sign('Corrigió la cantidad', { quantity: correction, reason });
            closeModal();
          }}
        >
          <label class="field">
            <span class="field__label">Cantidad corregida</span>
            <input
              class="field__input"
              type="text"
              inputMode="decimal"
              value={correction}
              onInput={(event) => setCorrection((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span class="field__label">Motivo</span>
            <textarea
              class="field__input"
              rows={2}
              value={reason}
              onInput={(event) => setReason((event.target as HTMLTextAreaElement).value)}
            />
          </label>
        </Modal>
      ) : null}

      {modal === 'recount' ? (
        <Modal
          icon="replay"
          tone="warn"
          title="Pedir reconteo de este artículo"
          body={MODAL_BODY.recount}
          cancelLabel="Cancelar"
          confirmLabel="Enviar solicitud"
          onCancel={closeModal}
          onConfirm={() => {
            // Deliberately does NOT verify: asking for a recount leaves the
            // alert open, because nothing has been decided yet.
            sign('Pidió reconteo', { reason });
            closeModal();
          }}
        >
          <label class="field">
            <span class="field__label">Motivo</span>
            <textarea
              class="field__input"
              rows={2}
              value={reason}
              onInput={(event) => setReason((event.target as HTMLTextAreaElement).value)}
            />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}

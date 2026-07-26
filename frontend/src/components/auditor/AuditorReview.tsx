/**
 * `AuditorReview` — the single `/auditor` island (design §5, REQ-AUD-1..5).
 *
 * Selection, filters, the three signed actions, the trace and the export gate
 * are one connected local-state tree, so they live in one island rather than
 * four coordinating ones. `close` and `base` stay static `.astro`.
 *
 * DATA SOURCE (task 5.5/5.6): live rows from `GET /api/auditor/records`, fetched
 * on mount through an injected seam and mapped by `lib/auditor/records.ts`. The
 * eight seed fixtures are no longer imported here; they survive as test data
 * handed to the same seam.
 *
 * WRITES ARE PESSIMISTIC (design D7). An auditor signature is drawn only after
 * `POST /api/auditor/actions` has returned 2xx, and the export saves a file only
 * after `POST /api/export` has persisted its batch (REQ-OE-2). Optimism here
 * would let a signature or a file exist that the database has no record of,
 * which is precisely what the trace exists to prevent.
 *
 * CORRECTED DESIGN BUG (REQ-AUD-5): the prototype's `blocked` modal is wired
 * backwards — its cancel control is labelled "Exportar de todos modos" but does
 * nothing, while the confirm control navigates. A control must never claim an
 * action it will not perform, and here the false claim is about the exact thing
 * the gate exists to prevent. The affordance is REMOVED: the modal offers
 * "Cancelar" and "Ver los pendientes", and no control anywhere in it mentions
 * exporting.
 */
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import {
  downloadExport as realDownloadExport,
  fetchAuditorRecords,
  postAuditorAction,
  saveExportFile,
  type AuditorActionInput,
  type ExportDownload,
} from '../../lib/api/operational';
import { toAuditorRecords } from '../../lib/auditor/records';
import type { AuditorRecord, TraceEntry, Warehouse } from '../../lib/auditor/types';
import { isOpenAlert, openAlertCount } from '../../lib/auditor/types';
import { DetailPane } from './DetailPane';
import { Modal } from './Modal';
import type { RecordFilter } from './RecordList';
import { RecordList } from './RecordList';
import { WarehouseList } from './WarehouseList';

type ModalKind = 'blocked' | 'export' | 'correct' | 'recount';

export interface AuditorReviewProps {
  /** The plan under review. Empty means the page was opened without one. */
  planId?: string;
  /** Signs every action written to `auditor_actions`. */
  auditorId?: string;
  warehouses?: readonly Warehouse[];
  /** Gates the export while any alert is open. Default `true`. */
  strictExport?: boolean;
  auditorName?: string;
  eyebrow?: string;
  /** Injected so trace timestamps are deterministic under test. */
  clock?: () => string;
  /** Fetch seam, defaulted to the real `GET /api/auditor/records`. */
  loadRecords?: (
    planId: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<readonly AuditorRecord[]>;
  /** Write seam (D7), defaulted to the real `POST /api/auditor/actions`. */
  submitAction?: (input: AuditorActionInput) => Promise<{ id: string; action: string }>;
  /** Export seam, defaulted to the real `POST /api/export`. */
  runExport?: (input: { planId: string; auditorId: string }) => Promise<ExportDownload>;
  /** Save seam, so tests assert WHAT would be saved without touching the DOM. */
  saveFile?: (download: ExportDownload) => void;
}

/** The production fetch: one HTTP call plus the pure storage->display mapping. */
async function defaultLoadRecords(
  planId: string,
  opts?: { signal?: AbortSignal },
): Promise<readonly AuditorRecord[]> {
  return toAuditorRecords(await fetchAuditorRecords(planId, opts), planId);
}

type Load =
  | { kind: 'no-plan' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; records: readonly AuditorRecord[] };

const LOADING_NOTE = 'Cargando los registros…';
const LOAD_ERROR_NOTE = 'No pudimos cargar los registros de este plan.';
const NO_PLAN_NOTE = 'Falta el plan a revisar en la dirección de esta página.';
const ACTION_ERROR_NOTE = 'No pudimos guardar la acción del auditor. Nada quedó firmado.';
const EXPORT_ERROR_NOTE = 'No pudimos generar el archivo. No se descargó nada.';

/**
 * `/auditor` is a prerendered page, so the plan and auditor under review can
 * only arrive in the URL (`?plan=&auditor=`). Reading them here rather than in
 * the `.astro` frontmatter is what keeps that page static.
 */
function paramFromUrl(key: string): string {
  if (typeof location === 'undefined') return '';
  return new URLSearchParams(location.search).get(key) ?? '';
}

/** es-CO display quantity ("30", "6,5") back into the number the route wants. */
function parseQuantity(value: string): number | undefined {
  const parsed = Number(value.replace('−', '-').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
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
  planId = paramFromUrl('plan'),
  auditorId = paramFromUrl('auditor'),
  warehouses = [],
  strictExport = true,
  auditorName = 'Auditor',
  eyebrow = '',
  clock = defaultClock,
  loadRecords = defaultLoadRecords,
  submitAction = postAuditorAction,
  runExport = realDownloadExport,
  saveFile = saveExportFile,
}: AuditorReviewProps) {
  const [load, setLoad] = useState<Load>(planId === '' ? { kind: 'no-plan' } : { kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(
    warehouses.find((w) => w.selected)?.id ?? warehouses[0]?.id ?? '',
  );
  const [filter, setFilter] = useState<RecordFilter>('mirada');
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [correction, setCorrection] = useState('');
  const [reason, setReason] = useState('');
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (planId === '') {
      setLoad({ kind: 'no-plan' });
      return;
    }

    const controller = new AbortController();
    let live = true;

    setLoad({ kind: 'loading' });
    loadRecords(planId, { signal: controller.signal })
      .then((fetched) => {
        if (!live) return;
        setLoad({ kind: 'ready', records: fetched });
        setSelectedId(fetched[0]?.id ?? null);
      })
      .catch(() => {
        // An empty list would claim the plan has nothing counted, which is a
        // different fact from "we could not ask". Never conflate the two.
        if (live) setLoad({ kind: 'error' });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [loadRecords, planId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const records = load.kind === 'ready' ? load.records : [];
  const openAlerts = openAlertCount(records);
  const closedCount = warehouses.filter((w) => w.state === 'cerrada').length;
  const selected = records.find((record) => record.id === selectedId) ?? null;

  const visible = useMemo(() => {
    if (filter === 'mirada') return records.filter(isOpenAlert);
    if (filter === 'verificados') return records.filter((record) => record.verified);
    return records;
  }, [records, filter]);

  /**
   * Every auditor action writes one `auditor_actions` row and only THEN appends
   * its signed line (RF-32, REQ-AUD-4, design D7). The local state is touched
   * inside the `then`: if the write is refused, nothing on screen ever claimed
   * it happened.
   */
  const sign = async (
    action: string,
    input: Omit<AuditorActionInput, 'auditorId' | 'recordId'>,
    options: { verify?: boolean; quantity?: string; reason?: string } = {},
  ) => {
    if (selected === null) return;
    const recordId = selected.id;

    setWriteError(null);
    try {
      await submitAction({ auditorId, recordId, ...input });
    } catch {
      setWriteError(ACTION_ERROR_NOTE);
      return;
    }

    const entry: TraceEntry = {
      user: auditorName,
      time: clock(),
      action,
      ...(options.reason !== undefined && options.reason !== '' ? { reason: options.reason } : {}),
    };

    setLoad((current) =>
      current.kind === 'ready'
        ? {
            kind: 'ready',
            records: current.records.map((record) =>
              record.id === recordId
                ? {
                    ...record,
                    verified: options.verify === true ? true : record.verified,
                    counted:
                      options.quantity === undefined
                        ? record.counted
                        : { ...record.counted, quantity: options.quantity },
                    // Newest first: the auditor reads the latest decision.
                    trace: [entry, ...record.trace],
                  }
                : record,
            ),
          }
        : current,
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

  /** REQ-OE-2: the modal closes and a file is saved only after the batch exists. */
  const onGenerate = async () => {
    setWriteError(null);
    try {
      const download = await runExport({ planId, auditorId });
      saveFile(download);
    } catch {
      setWriteError(EXPORT_ERROR_NOTE);
      return;
    }
    closeModal();
  };

  const headerTitle = `${warehouses.find((w) => w.id === warehouseId)?.name ?? ''} · revisión`;

  return (
    <div class="review">
      <header class="review__head">
        <div>
          <p class="review__eyebrow">{eyebrow}</p>
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

      {load.kind === 'loading' ? (
        <p class="review__loading" role="status">
          {LOADING_NOTE}
        </p>
      ) : null}

      {load.kind === 'error' ? (
        <div class="review__error" role="alert">
          <p>{LOAD_ERROR_NOTE}</p>
          <button type="button" class="btn btn--secondary" onClick={retry}>
            Reintentar
          </button>
        </div>
      ) : null}

      {load.kind === 'no-plan' ? (
        <p class="review__error" role="alert">
          {NO_PLAN_NOTE}
        </p>
      ) : null}

      {writeError === null ? null : (
        <p class="review__error" role="alert">
          {writeError}
        </p>
      )}

      {load.kind !== 'ready' ? null : (
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
            onApprove={() => {
              void sign('Aprobó el registro', { action: 'approve' }, { verify: true });
            }}
            onCorrect={() => {
              setCorrection(selected?.counted.quantity ?? '');
              setModal('correct');
            }}
            onRecount={() => setModal('recount')}
          />
        </aside>
      </div>
      )}

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
          onConfirm={() => {
            void onGenerate();
          }}
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
            void sign(
              'Corrigió la cantidad',
              {
                action: 'correct',
                ...(parseQuantity(correction) === undefined
                  ? {}
                  : { newQuantity: parseQuantity(correction) }),
                ...(reason === '' ? {} : { note: reason }),
              },
              { quantity: correction, reason },
            );
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
            void sign(
              'Pidió reconteo',
              { action: 'request_recount', ...(reason === '' ? {} : { note: reason }) },
              { reason },
            );
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

/**
 * The list of records captured in this bodega (design contract §2 S3;
 * REQ-OCF-2, REQ-OCF-4, REQ-OCF-7, REQ-OCF-11).
 *
 * The row renders a WHITELIST of `CountRecord` fields. That is the mechanical
 * guarantee behind blind counting (RF-18): even if an auditor-shaped object
 * with a system quantity reached this component, there is no code path that
 * could print it.
 *
 * Nulls are rendered honestly, never coerced: ~18.4% of real `nr_articulo` are
 * NULL, and `unidad_display` is null whenever the matcher could not resolve a
 * unit. The canonical English `unidad` never reaches this file at all — the
 * reducer already dropped it.
 */
import type { CountRecord, RecordState, SessionEvent } from '../../lib/session/types';

export interface RecordListProps {
  records: readonly CountRecord[];
  dispatch: (event: SessionEvent) => void;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Colombian decimal comma: the design shows `6,5`, never `6.5`. */
export function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity).replace('.', ',');
}

/** `8:12 a.m.`, matching the design's mono meta line. */
export function formatRecordTime(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = date.getHours();
  const suffix = hours < 12 ? 'a.m.' : 'p.m.';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(date.getMinutes()).padStart(2, '0')} ${suffix}`;
}

interface StateIcon {
  icon: string;
  /** Accessible name — the design conveys state by colour alone. */
  label: string;
}

/**
 * `sync` is an in-session PENDING UPLOAD and is labelled as such. RNF-08
 * (offline-first) was removed from the product, so no copy here may suggest the
 * app keeps working without a connection (REQ-OCF-11 / C2).
 */
const STATE_ICONS: Record<RecordState, StateIcon> = {
  ok: { icon: 'check_circle', label: 'Registro confirmado' },
  anom_open: { icon: 'flag', label: 'Registro señalado sin resolver' },
  anom_noted: { icon: 'flag', label: 'Registro señalado con nota al auditor' },
  sync: { icon: 'cloud_upload', label: 'Pendiente de subir' },
};

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function RecordList({ records, dispatch }: RecordListProps) {
  return (
    <ul class="records">
      {records.map((record) => {
        const state = STATE_ICONS[record.state];
        return (
          <li key={record.id} class={`record record--${record.state}`}>
            <p class="record__qty">{formatQuantity(record.quantity)}</p>
            {/* Null unit renders NOTHING — never "null", never a guessed unit. */}
            {record.unitDisplay === null ? null : (
              <p class="record__unit" data-testid="record-unit">
                {record.unitDisplay}
              </p>
            )}

            <div class="record__body">
              <p class="record__name">{record.articulo}</p>
              <p class="record__meta mono" data-testid="record-meta">
                {record.nrArticulo ?? 'Sin código'} · {formatRecordTime(record.createdAt)}
              </p>
            </div>

            <span class="msr record__state" role="img" aria-label={state.label}>
              {state.icon}
            </span>

            {/* Deletion is TOUCH-ONLY (RF-21): voice creates records and can
                never edit or delete one, so correction is delete-then-redictate. */}
            <button
              type="button"
              class="record__delete"
              aria-label={`Eliminar registro · ${record.articulo}`}
              onClick={() => dispatch({ type: 'RECORD_DELETED', id: record.id })}
            >
              <span class="msr" aria-hidden="true">
                delete
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default RecordList;

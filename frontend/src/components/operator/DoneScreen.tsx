/**
 * S9 «Conteo enviado» — the end of the operator flow (design contract §2 S9,
 * REQ-OCF-9, RF-30, RF-32).
 *
 * Every number on this screen is DERIVED from the session that just ran. The
 * design ships fixed mock values ("107 / 107", "112", "3", "41 min"); rendering
 * those verbatim would tell the operator they counted things they did not. The
 * LABELS are verbatim, the values are real.
 *
 * Blind counting holds here too: the summary reports what was counted and never
 * compares it to a system quantity (REQ-OCF-2).
 */
import { labelFor } from '../../lib/catalogues';
import type { SessionEvent, SessionState } from '../../lib/session/types';

export interface DoneScreenProps {
  state: SessionState;
  dispatch: (event: SessionEvent) => void;
  /** Wall-clock length of the count; the session owns the clock, not this view. */
  durationMs: number;
}

/** "41 min", and "1 h 12 min" once a count runs past the hour. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/**
 * Alerts the operator actually resolved BY KEEPING the record and leaving a
 * note. An «Eliminar y volver a dictar» leaves no record behind, so it cannot
 * be counted here — the alternative would be a stored counter that can drift
 * out of sync with the records themselves.
 */
export function resolvedAlerts(state: SessionState): number {
  return state.records.filter((record) => record.anomaly !== undefined).length;
}

export function DoneScreen({ state, dispatch, durationMs }: DoneScreenProps) {
  const bodega = state.catalogueId === null ? 'Esta bodega' : labelFor(state.catalogueId);

  return (
    <section class="done" aria-labelledby="done-title">
      <span class="msr done__mark" aria-hidden="true">
        task_alt
      </span>

      <h1 id="done-title" class="done__title">
        {bodega}
      </h1>
      <p class="done__subtitle">contada y enviada</p>

      <p class="done__body">
        El auditor ya puede revisarla. No hay nada que transcribir después.
      </p>

      <dl class="done__summary" data-testid="done-summary">
        <div class="done__row">
          <dt>Artículos contados</dt>
          <dd class="qty" data-testid="done-counted">
            {state.progress.counted} / {state.progress.total}
          </dd>
        </div>
        <div class="done__row">
          <dt>Registros por voz</dt>
          <dd class="qty" data-testid="done-records">
            {state.records.length}
          </dd>
        </div>
        <div class="done__row">
          <dt>Alertas resueltas</dt>
          <dd class="qty" data-testid="done-alerts">
            {resolvedAlerts(state)}
          </dd>
        </div>
        <div class="done__row">
          <dt>Tiempo total</dt>
          <dd class="qty" data-testid="done-duration">
            {formatDuration(durationMs)}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        class="done__cta"
        onClick={() => dispatch({ type: 'BACK_TO_PLANS' })}
      >
        Volver a mis conteos
      </button>
    </section>
  );
}

export default DoneScreen;

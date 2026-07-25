/**
 * S3 — the counting screen (design contract §2 S3; REQ-OCF-2, REQ-OCF-5,
 * REQ-OCF-9, REQ-OCF-11, REQ-VC-5, REQ-VC-8).
 *
 * AUTHORED CONTROL: «Terminar conteo». The prototype has no control leading to
 * the done screen at all, so S9 is unreachable in the design. REQ-OCF-9 adds
 * one here, disabled while an overlay is open or a pipeline request is in
 * flight, mirroring the reducer's own guard so the button can never look
 * available while the transition would be a no-op.
 *
 * Blind counting (RF-18) is structural, not a rule to remember: this screen
 * receives `SessionState`, whose `CountRecord` shape carries no theoretical
 * stock field at all, and it renders the record rows through `RecordList`,
 * which whitelists the fields it prints.
 */
import { labelFor } from '../../lib/catalogues';
import { blocked as isBlocked } from '../../lib/session/reducer';
import type { SessionEvent, SessionState } from '../../lib/session/types';
import { MicDock } from './MicDock';
import { RecordList } from './RecordList';

export interface CountScreenProps {
  state: SessionState;
  dispatch: (event: SessionEvent) => void;
  /** The session starts the real capture; the screen only reports the gesture. */
  onStartRecording?: () => void;
  /** REC_STOPPED needs the captured audio, which only the session holds. */
  onStopRecording?: () => void;
}

const BLIND_FOOTER = 'Conteo ciego: nunca verás el stock del sistema.';

export function CountScreen({
  state,
  dispatch,
  onStartRecording,
  onStopRecording,
}: CountScreenProps) {
  const blocked = isBlocked(state);
  const { counted, total } = state.progress;
  const recordCount = state.records.length;
  const finishDisabled = state.overlay !== null || state.requestInFlight;

  const start = (): void => {
    dispatch({ type: 'REC_STARTED' });
    onStartRecording?.();
  };

  return (
    <section class="count" aria-labelledby="count-title">
      <header class="count__header">
        <p class="count__eyebrow">Toma física</p>
        <h1 id="count-title" class="count__title">
          {state.catalogueId === null ? 'Sin bodega' : labelFor(state.catalogueId)}
        </h1>
        <div
          class="count__progress"
          role="progressbar"
          aria-label="Avance del conteo"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={counted}
        >
          <span
            class="count__progress-fill"
            style={{ width: total === 0 ? '0%' : `${(counted / total) * 100}%` }}
          />
        </div>
        <p class="count__progress-label">
          {counted} / {total}
        </p>
      </header>

      <div class="count__list-header">
        <h2>Registros de esta bodega</h2>
        <p>{recordCount === 1 ? '1 registro' : `${recordCount} registros`}</p>
      </div>

      <RecordList records={state.records} dispatch={dispatch} />

      <p class="count__blind-footer">{BLIND_FOOTER}</p>

      <footer class="count__actions">
        <MicDock
          recording={state.recording}
          blocked={blocked}
          onStart={start}
          onStop={() => onStopRecording?.()}
        />
        <button
          type="button"
          class="btn btn--secondary"
          disabled={finishDisabled}
          onClick={() => dispatch({ type: 'COUNT_FINISHED' })}
        >
          Terminar conteo
        </button>
      </footer>
    </section>
  );
}

export default CountScreen;

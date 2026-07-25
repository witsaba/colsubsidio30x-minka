/**
 * Operator session state machine contracts (design §6, REQ-OCF-1).
 *
 * FROZEN by T3 — T7 writes the reducer against this file, T16-T20 render from
 * it. Do not edit; request a change from the T3 owner.
 *
 * The reducer is PURE: no DOM, no fetch, no timers. Side effects (getUserMedia,
 * runPipeline, match re-queries) run in `CountSession` and feed results back as
 * events. The reducer is also TOTAL: any event it does not handle returns the
 * identical state object.
 */
import type { Anomaly } from '../anomaly/engine';
import type { CapturedAudio } from '../audio/types';
import type { Candidate, UiError } from '../api/types';
import type { ExtractedItem } from '../extraction/adapter';
import type { ConfirmableItem, PipelineOutcome, QueueEntry } from '../pipeline';

/* -------------------------------------------------------------------------- */
/* Screens and overlays                                                       */
/* -------------------------------------------------------------------------- */

/** S1 consent, S2 plans, S3 counting, S9 summary. Overlays open only over
 *  `count` (REQ-OCF-1). */
export type Screen = 'permiso' | 'plans' | 'count' | 'done';

/**
 * S8 "excluir del conteo" was stretch scope (S1 in the task list) and was CUT.
 * Its `ExcludeReason` type, its `exclude` overlay variant and its four
 * `EXCLUDE_*` events were removed rather than left half-wired: the reducer
 * could open an `exclude` overlay that `CountSession` renders nothing for, and
 * an open overlay both blocks the mic and disables «Terminar conteo» — a state
 * with no way out. `tests/session/no-soft-lock.test.ts` explores the reducer
 * and fails if any overlay without a sheet is reintroduced.
 */

export type Overlay =
  /** S4. `transcript` fills in progressively as STT resolves; null until then. */
  | { kind: 'processing'; transcript: string | null }
  /** S5. N confirmable items recombined into ONE sheet. */
  | { kind: 'confirm'; transcript: string; items: ConfirmableItem[] }
  /** S6. Blocks the mic until resolved. */
  | { kind: 'anomaly'; item: ConfirmableItem; anomaly: Anomaly; queue: QueueEntry[] }
  /** S7. Serves `no_match` AND `ambiguous` (D8). */
  | { kind: 'search'; item: ExtractedItem; candidates: Candidate[]; query: string; queue: QueueEntry[] }
  | null;

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `ok`         confirmed and settled.
 * `anom_open`  flagged and unresolved — while any record is `anom_open` the mic
 *              is blocked (REQ-OCF-5).
 * `anom_noted` operator kept it and left a note for the auditor.
 * `sync`       in-session "pending upload" ONLY. It must never be presented as
 *              offline capability (REQ-OCF-11 / C2).
 */
export type RecordState = 'ok' | 'anom_open' | 'anom_noted' | 'sync';

export interface CountRecord {
  id: string;
  quantity: number;
  /** Rendered from `Candidate.unidad_display` only. Null renders no unit text;
   *  the English `unidad` is NEVER rendered (REQ-OCF-7). */
  unitDisplay: string | null;
  /** The catalogue article name that was matched. */
  articulo: string;
  /** Null renders the SKU line without a code (REQ-OCF-7). */
  nrArticulo: string | null;
  /** What the operator actually said, kept for the auditor trace. */
  spokenName: string;
  state: RecordState;
  /** Set when the record was kept despite an anomaly (`anom_noted`). */
  anomaly?: Anomaly;
  /** Epoch ms; supplied by the caller so the reducer stays pure. */
  createdAt: number;
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export interface SessionState {
  screen: Screen;
  overlay: Overlay;
  /** S1 checkbox. `MIC_REQUESTED` is a no-op while this is false. */
  consentChecked: boolean;
  micPermission: 'unknown' | 'granted' | 'denied';
  recording: boolean;
  /** A pipeline promise is pending. Guards the mic and «Terminar conteo». */
  requestInFlight: boolean;
  /** Newest first. */
  records: CountRecord[];
  /** Seeded 45/107 from the operator fixture. */
  progress: { counted: number; total: number };
  /**
   * The real matcher catalogue chosen on the plans screen (REQ-OCF-8). Null
   * before `PLAN_STARTED`. Not in design §6's struct listing, but every match
   * request needs it, so it is authored into the state here.
   */
  catalogueId: string | null;
  /**
   * The transcript of the utterance currently being resolved; null before the
   * first one.
   *
   * AUTHORED by T13 to close a real gap: `Overlay.confirm` requires a
   * `transcript`, but the frozen `anomaly` and `search` variants carry none, so
   * a queue advance OUT of an anomaly or a search into the combined confirm
   * sheet had no transcript to pass and fell back to `''` — the operator lost
   * what they had just said exactly when asked to confirm it.
   *
   * It lives on the state rather than on those two overlay variants because
   * overlay literals are hand-built all over the component tests, so a new
   * required field there would break concurrent work; every `SessionState` is
   * built by spreading `initialSessionState`, so a new field here is absorbed.
   * Set on `PIPELINE_TRANSCRIPT` / `PIPELINE_RESOLVED`, read by every advance.
   */
  lastTranscript: string | null;
  /** Error banner on the count screen. */
  error: UiError | null;
}

/**
 * DERIVED, never stored (design §6). While true the mic guard fails and the
 * count screen shows "Micrófono en pausa hasta resolver el registro señalado."
 * T7 implements it; the signature is frozen here so components can import it.
 */
export type BlockedPredicate = (state: SessionState) => boolean;

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The COMPLETE event union (design §6 transition table). Guards live in the
 * reducer, not in the types. Anything not handled is a no-op.
 */
export type SessionEvent =
  /* --- S1 consent / microphone permission ------------------------------- */
  | { type: 'CONSENT_TOGGLED' }
  /** Guard: `consentChecked`. Effect: the real `getUserMedia` call. */
  | { type: 'MIC_REQUESTED' }
  | { type: 'MIC_GRANTED' }
  | { type: 'MIC_DENIED' }

  /* --- S2 plans --------------------------------------------------------- */
  | { type: 'PLAN_STARTED'; catalogueId: string }

  /* --- S3 recording ----------------------------------------------------- */
  /** Guard: `!blocked && overlay === null && !requestInFlight && micPermission === 'granted'`. */
  | { type: 'REC_STARTED' }
  /** Guard: `recording`. Effect: `runPipeline`. */
  | { type: 'REC_STOPPED'; audio: CapturedAudio }
  /** Client-side refusal BEFORE any upload (D10). */
  | { type: 'REC_REJECTED'; reason: 'too_large' | 'too_short' }

  /* --- S4 pipeline ------------------------------------------------------ */
  /** Progressive reveal inside the processing overlay. */
  | { type: 'PIPELINE_TRANSCRIPT'; raw: string }
  | { type: 'PIPELINE_RESOLVED'; outcome: PipelineOutcome }
  | { type: 'PIPELINE_FAILED'; error: UiError }

  /* --- S5 confirm ------------------------------------------------------- */
  /** Appends one record per confirmable item and bumps `progress`. */
  | { type: 'CONFIRM_ACCEPTED'; at: number }
  /** Discards the whole sheet; no record is created. */
  | { type: 'CONFIRM_REPEAT' }

  /* --- S6 anomaly ------------------------------------------------------- */
  | { type: 'ANOMALY_REDICTATE' }
  | { type: 'ANOMALY_KEEP_NOTED'; at: number }

  /* --- S7 manual search ------------------------------------------------- */
  /** Effect: a debounced `match()` re-query. */
  | { type: 'SEARCH_QUERY_CHANGED'; query: string }
  | { type: 'SEARCH_RESULTS'; candidates: Candidate[] }
  | { type: 'SEARCH_PICKED'; candidate: Candidate }
  /** "Ninguno · volver a dictar" — drops the item, advances the queue. */
  | { type: 'SEARCH_DISMISSED' }

  /* --- records ---------------------------------------------------------- */
  /**
   * Touch-only deletion. Voice CREATES records and never edits or deletes
   * them, so correction is delete-then-redictate (REQ-OCF-4). Authored beyond
   * design §6's table, which has no delete transition.
   */
  | { type: 'RECORD_DELETED'; id: string }

  /* --- finishing -------------------------------------------------------- */
  /** Guard: `overlay === null && !requestInFlight` (REQ-OCF-9, D9). */
  | { type: 'COUNT_FINISHED' }
  | { type: 'BACK_TO_PLANS' }

  /* --- error banner ----------------------------------------------------- */
  | { type: 'ERROR_DISMISSED' };

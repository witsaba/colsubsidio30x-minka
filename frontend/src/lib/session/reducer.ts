/**
 * The operator session state machine (design §6; REQ-OCF-1, 3, 4, 5, 9).
 *
 * PURE, TOTAL and DOM-free: no clock, no fetch, no globals, no timers. Every
 * side effect (getUserMedia, runPipeline, debounced match re-queries) runs in
 * `CountSession` and comes back as an event. Timestamps arrive on the events
 * that create records (`CONFIRM_ACCEPTED`, `ANOMALY_KEEP_NOTED`), which is why
 * the reducer needs no clock of its own.
 *
 * Two rules hold everywhere below:
 *   - Any event that does not apply returns the IDENTICAL state object, so
 *     `useReducer` never re-renders on a no-op.
 *   - `blocked` is DERIVED, never stored (see `blocked()`).
 */
import type { Anomaly } from '../anomaly/engine';
import { UiError } from '../api/types';
import type { Candidate, MatchResponse } from '../api/types';
import type { ConfirmableItem, QueueEntry } from '../pipeline';
import type { CountRecord, Overlay, SessionEvent, SessionState } from './types';

/* -------------------------------------------------------------------------- */
/* Initial state                                                              */
/* -------------------------------------------------------------------------- */

/** Progress is seeded from the operator fixture (design §6: 45/107). */
export const initialSessionState: SessionState = {
  screen: 'permiso',
  overlay: null,
  consentChecked: false,
  micPermission: 'unknown',
  recording: false,
  requestInFlight: false,
  records: [],
  progress: { counted: 45, total: 107 },
  catalogueId: null,
  error: null,
};

/* -------------------------------------------------------------------------- */
/* Derived predicates                                                         */
/* -------------------------------------------------------------------------- */

/**
 * RF-28 preventive block. DERIVED from the current state — deliberately not a
 * `SessionState` field, so it can never drift out of sync with the overlay or
 * the record list.
 *
 * It does NOT stop an in-flight recording (RF-29): the only transition that
 * clears `recording` is `REC_STOPPED`, which this predicate never guards.
 */
export function blocked(state: SessionState): boolean {
  return state.overlay?.kind === 'anomaly' || state.records.some((r) => r.state === 'anom_open');
}

/** REQ-OCF-1: overlays live only over the count screen. */
function canOverlay(state: SessionState): boolean {
  return state.screen === 'count';
}

/* -------------------------------------------------------------------------- */
/* Queue advance                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Open the overlay for the head of the queue.
 *
 * The pipeline orders the queue anomalies -> searches -> confirmables, so once
 * the head is a confirmable every remaining entry is too and they recombine
 * into ONE confirm sheet (design §6, REQ-OCF-3).
 *
 * `transcript` is only known when the queue comes straight off
 * `PIPELINE_RESOLVED`; the frozen `anomaly` / `search` overlay shapes carry no
 * transcript, so an anomaly- or search-resolved advance falls back to `''`.
 * See the T7 note in apply-progress: adding `transcript` to those two overlay
 * variants is a T3 change, not a T7 one.
 */
function openNext(queue: QueueEntry[], transcript: string): Overlay {
  const head = queue[0];
  if (!head) return null;
  const rest = queue.slice(1);

  if (head.kind === 'anomaly') {
    return { kind: 'anomaly', item: head.item, anomaly: head.anomaly, queue: rest };
  }
  if (head.kind === 'needs_search') {
    return {
      kind: 'search',
      item: head.item,
      candidates: head.candidates,
      // Prefill the search box with what the operator actually said.
      query: head.item.spokenName,
      queue: rest,
    };
  }
  const items = queue.flatMap((entry) => (entry.kind === 'confirmable' ? [entry.item] : []));
  return { kind: 'confirm', transcript, items };
}

/* -------------------------------------------------------------------------- */
/* Record creation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build a record from a resolved item. Ids are derived from the caller's
 * timestamp plus the current record count, so they stay unique without a
 * random source and the reducer stays pure.
 *
 * Only `unidad_display` reaches the record; the canonical English `unidad` is
 * dropped here so it can never be rendered (REQ-OCF-7). No theoretical or
 * system stock exists on this shape at all (REQ-OCF-2, RF-18).
 */
function toRecord(
  item: ConfirmableItem,
  at: number,
  seq: number,
  state: CountRecord['state'],
  anomaly?: Anomaly,
): CountRecord {
  return {
    id: `rec-${at}-${seq}`,
    quantity: item.extracted.quantity,
    unitDisplay: item.picked.unidad_display,
    articulo: item.picked.articulo,
    nrArticulo: item.picked.nr_articulo,
    spokenName: item.extracted.spokenName,
    state,
    ...(anomaly ? { anomaly } : {}),
    createdAt: at,
  };
}

/** Newest first (design §6). Voice only ever prepends — never edits (RF-20). */
function appendRecords(state: SessionState, created: CountRecord[]): SessionState {
  return {
    ...state,
    records: [...created, ...state.records],
    progress: { ...state.progress, counted: state.progress.counted + created.length },
  };
}

/**
 * A manual pick is the operator's verdict, not the matcher's, so the synthetic
 * `MatchResponse` carries an empty `request_id` rather than borrowing one from
 * a request that never returned this candidate.
 */
function pickedResponse(candidate: Candidate): MatchResponse {
  return {
    status: 'matched',
    candidates: [candidate],
    top_score: candidate.score,
    margin: 0,
    request_id: '',
  };
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    /* --- S1 consent / permission -------------------------------------- */

    case 'CONSENT_TOGGLED':
      if (state.screen !== 'permiso') return state;
      return { ...state, consentChecked: !state.consentChecked };

    /** Pure effect trigger: `CountSession` calls `getUserMedia` and dispatches
     *  MIC_GRANTED / MIC_DENIED. Guarded by consent (REQ-OCF-10 flow). */
    case 'MIC_REQUESTED':
      return state;

    case 'MIC_GRANTED':
      if (state.screen !== 'permiso') return state;
      return { ...state, micPermission: 'granted', screen: 'plans' };

    case 'MIC_DENIED':
      if (state.screen !== 'permiso') return state;
      // Stays on permiso; the designed keyboard-fallback note renders there.
      return { ...state, micPermission: 'denied' };

    /* --- S2 plans ------------------------------------------------------ */

    case 'PLAN_STARTED':
      if (state.screen !== 'plans') return state;
      return { ...state, screen: 'count', overlay: null, catalogueId: event.catalogueId };

    /* --- S3 recording -------------------------------------------------- */

    case 'REC_STARTED':
      if (
        state.screen !== 'count' ||
        state.recording ||
        state.overlay !== null ||
        state.requestInFlight ||
        state.micPermission !== 'granted' ||
        blocked(state)
      ) {
        return state;
      }
      return { ...state, recording: true };

    /**
     * Guarded ONLY by `recording` (RF-29): once the operator is dictating, an
     * anomaly raised meanwhile must not swallow the audio they just recorded.
     */
    case 'REC_STOPPED':
      if (!state.recording) return state;
      return {
        ...state,
        recording: false,
        requestInFlight: true,
        overlay: { kind: 'processing', transcript: null },
      };

    /** Client-side refusal BEFORE any upload (D10) — nothing is sent. */
    case 'REC_REJECTED': {
      if (state.screen !== 'count') return state;
      const code = event.reason === 'too_large' ? 'payload_too_large' : 'invalid_audio';
      return { ...state, recording: false, requestInFlight: false, error: new UiError(code) };
    }

    /* --- S4 pipeline --------------------------------------------------- */

    case 'PIPELINE_TRANSCRIPT':
      if (state.overlay?.kind !== 'processing') return state;
      return { ...state, overlay: { kind: 'processing', transcript: event.raw } };

    case 'PIPELINE_RESOLVED': {
      if (!state.requestInFlight && state.overlay?.kind !== 'processing') return state;
      return {
        ...state,
        requestInFlight: false,
        overlay: openNext(event.outcome.queue, event.outcome.transcript),
      };
    }

    case 'PIPELINE_FAILED':
      if (!state.requestInFlight && state.overlay?.kind !== 'processing') return state;
      return { ...state, requestInFlight: false, overlay: null, error: event.error };

    /* --- S5 confirm: yes/no only (REQ-OCF-3, RF-33) --------------------- */

    case 'CONFIRM_ACCEPTED': {
      if (state.overlay?.kind !== 'confirm') return state;
      const created = state.overlay.items.map((item, i) =>
        toRecord(item, event.at, state.records.length + i, 'ok'),
      );
      return { ...appendRecords(state, created), overlay: null };
    }

    case 'CONFIRM_REPEAT':
      if (state.overlay?.kind !== 'confirm') return state;
      // Discards the whole sheet: no record is created, the mic returns to idle.
      return { ...state, overlay: null };

    /* --- S6 anomaly (REQ-OCF-5) ---------------------------------------- */

    case 'ANOMALY_REDICTATE': {
      if (state.overlay?.kind !== 'anomaly') return state;
      // "Eliminar y volver a dictar": the item is dropped, never persisted.
      return { ...state, overlay: openNext(state.overlay.queue, '') };
    }

    case 'ANOMALY_KEEP_NOTED': {
      if (state.overlay?.kind !== 'anomaly') return state;
      const { item, anomaly, queue } = state.overlay;
      const kept = toRecord(item, event.at, state.records.length, 'anom_noted', anomaly);
      return { ...appendRecords(state, [kept]), overlay: openNext(queue, '') };
    }

    /* --- S7 manual search (REQ-OCF-6, D8) ------------------------------ */

    case 'SEARCH_QUERY_CHANGED':
      if (state.overlay?.kind !== 'search') return state;
      return { ...state, overlay: { ...state.overlay, query: event.query } };

    case 'SEARCH_RESULTS':
      if (state.overlay?.kind !== 'search') return state;
      return { ...state, overlay: { ...state.overlay, candidates: event.candidates } };

    case 'SEARCH_PICKED': {
      if (state.overlay?.kind !== 'search') return state;
      const resolved: ConfirmableItem = {
        extracted: state.overlay.item,
        match: pickedResponse(event.candidate),
        picked: event.candidate,
      };
      // Confirmables sort last, so the resolved item joins the tail of the
      // queue and lands on the combined confirm sheet (REQ-OCF-3).
      const queue: QueueEntry[] = [...state.overlay.queue, { kind: 'confirmable', item: resolved }];
      return { ...state, overlay: openNext(queue, '') };
    }

    case 'SEARCH_DISMISSED':
      if (state.overlay?.kind !== 'search') return state;
      // "Ninguno · volver a dictar": the item is dropped, the queue advances.
      return { ...state, overlay: openNext(state.overlay.queue, '') };

    /* --- S8 exclude (stretch) ------------------------------------------ */

    case 'EXCLUDE_OPENED':
      if (!canOverlay(state) || state.overlay !== null) return state;
      return { ...state, overlay: { kind: 'exclude', reason: null } };

    case 'EXCLUDE_REASON_PICKED':
      if (state.overlay?.kind !== 'exclude') return state;
      return { ...state, overlay: { kind: 'exclude', reason: event.reason } };

    case 'EXCLUDE_CONFIRMED':
      if (state.overlay?.kind !== 'exclude' || state.overlay.reason === null) return state;
      return { ...state, overlay: null };

    case 'EXCLUDE_DISMISSED':
      if (state.overlay?.kind !== 'exclude') return state;
      return { ...state, overlay: null };

    /* --- records: touch-only deletion (REQ-OCF-4, RF-21) --------------- */

    case 'RECORD_DELETED': {
      const records = state.records.filter((r) => r.id !== event.id);
      if (records.length === state.records.length) return state;
      const removed = state.records.length - records.length;
      return {
        ...state,
        records,
        progress: { ...state.progress, counted: Math.max(0, state.progress.counted - removed) },
      };
    }

    /* --- S9 «Terminar conteo» (REQ-OCF-9, D9 — authored control) -------- */

    case 'COUNT_FINISHED':
      if (state.screen !== 'count' || state.overlay !== null || state.requestInFlight) return state;
      return { ...state, screen: 'done' };

    case 'BACK_TO_PLANS':
      if (state.screen !== 'done') return state;
      // The session summary stays frozen: records are not cleared here.
      return { ...state, screen: 'plans', overlay: null };

    /* --- error banner --------------------------------------------------- */

    case 'ERROR_DISMISSED':
      if (state.error === null) return state;
      return { ...state, error: null };

    default:
      // Total by construction: an unrecognised event is the identity function.
      return state;
  }
}

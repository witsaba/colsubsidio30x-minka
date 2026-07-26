/**
 * `CountSession` — the operator island and the SINGLE composition root
 * (design §5, §6, §7; REQ-OCF-1, REQ-OCF-12, REQ-VC-7, D3, D4).
 *
 * Everything impure in the operator flow lives here and nowhere else:
 *
 *   - the `useReducer` that owns `SessionState`;
 *   - `getUserMedia`, reached through the consent screen's own CTA (REQ-VC-7)
 *     so a denial lands where the manual fallback is, not mid-count;
 *   - the recorder lifecycle — exactly one `RecorderHandle` per take;
 *   - the `runPipeline` invocation and its `PipelineDeps`, which is the one
 *     place the extraction composition (Module 2 seam) and
 *     `FixtureAnomalyEngine` (Module 4 seam) are named. The seam held: swapping
 *     extraction from the mock to the real service was one line here;
 *   - the live `match()` re-query behind the manual-search sheet.
 *
 * The reducer stays pure precisely because this component exists: every effect
 * above comes back as an event.
 *
 * Blind counting (RF-18 / REQ-OCF-2) is structural rather than remembered —
 * nothing in this file, in `CountRecord`, or in any screen below it can carry a
 * theoretical or system stock value, so there is no path by which one could
 * reach `/conteo`.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';

import { fixtureAnomalyEngine } from '../../lib/anomaly/fixtureEngine';
import { createHttpAnomalyEngine } from '../../lib/anomaly/httpEngine';
import type { AnomalyEngine } from '../../lib/anomaly/engine';
import { match as realMatch, transcribe as realTranscribe } from '../../lib/api/client';
import {
  createRecord as realCreateRecord,
  deleteRecord as realDeleteRecord,
  fetchPlans as realFetchPlans,
  fetchRecords as realFetchRecords,
  postConsent as realPostConsent,
  type ConsentInput,
  type CreateRecordInput,
  type CreatedRecord,
  type PlanSummary,
  type RestoredRecordDto,
} from '../../lib/api/operational';
import { UiError } from '../../lib/api/types';
import type { Candidate, MatchFn, TranscribeFn } from '../../lib/api/types';
import { DEMO_OPERATOR_ID } from '../../lib/identity';
import { createRecorder, exceedsSizeLimit, requestMicrophone } from '../../lib/audio/capture';
import type { MicrophoneResult } from '../../lib/audio/capture';
import type { RecorderHandle } from '../../lib/audio/types';
import { mockExtractionAdapter } from '../../lib/extraction/mock';
import { httpExtractionAdapter } from '../../lib/extraction/http';
import { withFallback } from '../../lib/extraction/fallback';
import type { ExtractionAdapter } from '../../lib/extraction/adapter';
import { runPipeline, type PipelineDeps } from '../../lib/pipeline';
import { initialSessionState, sessionReducer } from '../../lib/session/reducer';
import { readResumeContext, toCountRecord, writeResumeContext } from '../../lib/session/resume';
import type { SessionEvent } from '../../lib/session/types';
import { AnomalySheet } from './AnomalySheet';
import { ConfirmSheet } from './ConfirmSheet';
import { ConsentScreen } from './ConsentScreen';
import { CountScreen } from './CountScreen';
import { DoneScreen } from './DoneScreen';
import { PlansScreen } from './PlansScreen';
import { PIPELINE_ERROR_COPY, ProcessingSheet } from './ProcessingSheet';
import { SearchSheet } from './SearchSheet';

export interface CountSessionProps {
  /** Seams, all defaulted to the real implementations. Tests inject doubles. */
  transcribe?: TranscribeFn;
  match?: MatchFn;
  extraction?: ExtractionAdapter;
  /**
   * Overrides the engine entirely. Left out, the composition root picks the
   * REAL `httpAnomalyEngine` once a plan is active and the fixture engine
   * before that — design D4's promised one-line swap, made here and nowhere else.
   */
  anomalies?: AnomalyEngine;
  requestMic?: () => Promise<MicrophoneResult>;
  openRecorder?: (stream: MediaStream) => RecorderHandle;
  /** Injectable clock: the reducer has none and the summary needs one. */
  now?: () => number;
  /** Debounce applied to the manual-search re-query. */
  searchDebounceMs?: number;
  operatorName?: string;
  /** Who the browser claims to be (design D2 — see `lib/identity.ts`). */
  operatorId?: string;
  /** Operational seams, defaulted to `lib/api/operational.ts`. */
  loadPlans?: (operatorId: string, opts?: { signal?: AbortSignal }) => Promise<PlanSummary[]>;
  persistConsent?: (input: ConsentInput) => Promise<unknown>;
  persistRecord?: (input: CreateRecordInput) => Promise<CreatedRecord>;
  removeRecord?: (
    id: string,
    input: { operatorId: string; reason?: string },
  ) => Promise<{ id: string; deleted: boolean }>;
  /** Session resume (REQ-OCF-13): the operator's already-counted records. */
  loadRecords?: (
    planId: string,
    operatorId: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<RestoredRecordDto[]>;
  /**
   * Where the active plan scope is remembered across a reload. Defaults to the
   * real `sessionStorage`; tests inject an in-memory one, and `null` disables
   * resume entirely.
   */
  resumeStorage?: Storage | null;
}

/**
 * Anything that escapes the pipeline is already a `UiError`; this is the last
 * line of defence so an unexpected throw still reaches the operator as authored
 * Spanish instead of a blank screen.
 */
function toUiError(error: unknown): UiError {
  return error instanceof UiError ? error : new UiError('vendor_error');
}

/**
 * The shipped extraction wiring (REQ-EXT-5, REQ-EXT-7).
 *
 * The real service leads; the deterministic mock catches any failure for that
 * one utterance. Built once at module level because it is stateless — putting
 * it in the default parameter would rebuild the composition on every render and
 * churn the `deps` memo.
 *
 * ROLLBACK: pass `mockExtractionAdapter` here instead. The route and the HTTP
 * adapter go inert without any other edit.
 */
const realExtraction: ExtractionAdapter = withFallback(httpExtractionAdapter, mockExtractionAdapter);

export function CountSession({
  transcribe = realTranscribe,
  match = realMatch,
  extraction = realExtraction,
  anomalies,
  requestMic = requestMicrophone,
  openRecorder = createRecorder,
  now = Date.now,
  searchDebounceMs,
  operatorName,
  operatorId = DEMO_OPERATOR_ID,
  loadPlans = realFetchPlans,
  persistConsent = realPostConsent,
  persistRecord = realCreateRecord,
  removeRecord = realDeleteRecord,
  loadRecords = realFetchRecords,
  resumeStorage,
}: CountSessionProps) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  // Async work resolves long after the render that started it, so effects read
  // the session through a ref instead of a captured, already-stale value.
  const stateRef = useRef(state);
  stateRef.current = state;

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const searchSeq = useRef(0);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  useEffect(() => {
    if (state.screen === 'count' && startedAt === null) setStartedAt(now());
    if (state.screen === 'done' && finishedAt === null) setFinishedAt(now());
  }, [state.screen, startedAt, finishedAt, now]);

  /* --------------------------------------------------- session resume (OCF-13) */

  /**
   * ONE attempt per mount. The effect is deliberately keyed on nothing: a
   * resume is a mount-time question, and re-running it later could overwrite
   * records the operator has since dictated.
   */
  const resumeAttempted = useRef(false);

  useEffect(() => {
    if (resumeAttempted.current) return;
    resumeAttempted.current = true;

    const scope = readResumeContext(resumeStorage);
    if (scope === null) return;

    const controller = new AbortController();

    void (async () => {
      // The stream did not survive the reload. Re-acquire it BEFORE resuming:
      // the browser remembers this origin's grant, so it is silent, and a
      // failure must land the operator on the consent screen rather than on a
      // count screen whose mic button does nothing.
      const mic = await requestMic();
      if (!mic.ok) return;

      let restored;
      try {
        restored = await loadRecords(scope.planId, scope.operatorId, { signal: controller.signal });
      } catch {
        // Resuming with an empty list would be WORSE than not resuming: the
        // operator would re-dictate shelves that are already in the database,
        // and every one of them would be written again under a new
        // `client_record_id`. Staying on consent is the safe failure.
        return;
      }
      if (controller.signal.aborted) return;

      streamRef.current = mic.stream;
      dispatch({ ...scope, type: 'SESSION_RESUMED', records: restored.map(toCountRecord) });
    })();

    return () => controller.abort();
  }, [loadRecords, requestMic, resumeStorage]);

  /* ------------------------------------------------------- anomaly engine (D4) */

  const { planId, warehouseId } = state;
  const { screen, catalogueId, operatorId: activeOperatorId } = state;

  /**
   * Remember (and forget) which plan is being counted.
   *
   * Only the four scope ids are stored — `resume.ts` projects them explicitly,
   * so no figure can reach storage and RF-18 cannot be laundered through it.
   * Cleared on `done` because the count is over: the next session must start
   * from the plans screen, not silently reopen a finished plan.
   */
  useEffect(() => {
    if (screen === 'done') {
      writeResumeContext(null, resumeStorage);
      return;
    }
    if (screen !== 'count') return;
    if (catalogueId === null || planId === null || activeOperatorId === null || warehouseId === null) {
      // The fixture/demo path has no plan behind it; there is nothing a resume
      // could fetch, so nothing is remembered.
      return;
    }
    writeResumeContext(
      { catalogueId, planId, operatorId: activeOperatorId, warehouseId },
      resumeStorage,
    );
  }, [screen, catalogueId, planId, activeOperatorId, warehouseId, resumeStorage]);

  /**
   * The one place the engine is chosen. With a plan in hand the REAL service is
   * used — it is the only one that knows this warehouse's statistics. Before
   * that (and in the fixture demo path) the offline rules stand in, because a
   * validation request with no plan scope has nothing to validate against.
   */
  const engine: AnomalyEngine = useMemo(() => {
    if (anomalies) return anomalies;
    if (planId === null || warehouseId === null) return fixtureAnomalyEngine;
    return createHttpAnomalyEngine({
      planId,
      warehouseId,
      // The browser holds no product table: the article travels as the
      // matcher's `nr_articulo` and the ROUTE resolves it to a uuid.
      productIdOf: () => null,
    });
  }, [anomalies, planId, warehouseId]);

  /* ---------------------------------------------------------------- pipeline */

  const deps: PipelineDeps = useMemo(
    () => ({
      transcribe,
      extraction,
      match,
      anomalies: engine,
      // The producer of `PIPELINE_TRANSCRIPT`: the S4 sheet shows what was heard
      // while the match calls are still in flight.
      onTranscript: (raw: string) => dispatch({ type: 'PIPELINE_TRANSCRIPT', raw }),
    }),
    [transcribe, extraction, match, engine],
  );

  const runChain = useCallback(
    async (audio: Parameters<typeof runPipeline>[0]): Promise<void> => {
      const catalogueId = stateRef.current.catalogueId;
      if (catalogueId === null) return;
      try {
        const outcome = await runPipeline(audio, catalogueId, deps);
        dispatch({ type: 'PIPELINE_RESOLVED', outcome });
      } catch (error) {
        dispatch({ type: 'PIPELINE_FAILED', error: toUiError(error) });
      }
    },
    [deps],
  );

  /* ------------------------------------------------------- persistence (D5/D6) */

  /**
   * Record ids whose write has already been fired. The effect below is driven by
   * `state.records`, which changes for many reasons, so this ref is what keeps
   * one confirmed count to exactly one POST.
   *
   * It is also the no-auto-retry rule: `RECORD_PERSIST_FAILED` deliberately
   * leaves the record in `sync`, and re-firing on the next render would hammer a
   * server that just failed. The banner tells the operator what happened.
   */
  const attempted = useRef<Set<string>>(new Set());

  /**
   * OPTIMISTIC (design D5). The reducer has already appended the record in
   * `sync`; this effect is the side of the split that talks to the network and
   * feeds the outcome back as an event. Driving it off the RECORD STATE rather
   * than off the confirm handler means the anomaly "keep noted" path is covered
   * by exactly the same code — there is no second persistence path to forget.
   */
  useEffect(() => {
    if (planId === null) return;

    for (const record of state.records) {
      if (record.state !== 'sync' || record.serverId) continue;
      if (attempted.current.has(record.id)) continue;
      attempted.current.add(record.id);

      void (async () => {
        try {
          const created = await persistRecord({
            // The local id IS the idempotency key: a retried POST resolves to
            // the existing row instead of counting the same shelf twice.
            clientRecordId: record.id,
            planId,
            operatorId,
            nrArticulo: record.nrArticulo,
            // The catalogue name is the fallback identity for the ~18.4% of
            // products with no sku (task 6.10); without it they cannot be counted.
            articulo: record.articulo,
            quantity: record.quantity,
            unitCode: record.unitCode,
            spokenName: record.spokenName,
          });
          dispatch({ type: 'RECORD_PERSISTED', id: record.id, serverId: created.id });
        } catch (error) {
          dispatch({ type: 'RECORD_PERSIST_FAILED', id: record.id, error: toUiError(error) });
        }
      })();
    }
  }, [state.records, planId, operatorId, persistRecord]);

  /**
   * Deletion is a SOFT delete on the server (RF-21, design D6), and the reducer
   * drops the row from the screen, so the server call has to be made from the
   * event on its way in — afterwards the record is gone and its `serverId` with
   * it. Wrapping dispatch keeps that in ONE place instead of threading a second
   * callback through `CountScreen` and `RecordList`.
   */
  const dispatchWithEffects = useCallback(
    (event: SessionEvent): void => {
      if (event.type === 'RECORD_DELETED') {
        const record = stateRef.current.records.find((r) => r.id === event.id);
        // No `serverId` means the write never landed: there is nothing to soft
        // delete, and inventing an id to delete would be worse than doing nothing.
        if (record?.serverId) {
          void removeRecord(record.serverId, { operatorId }).catch((error) => {
            // The row is already off the screen, so there is no record left to
            // attach a banner to. Logged rather than swallowed: a failed soft
            // delete leaves a live `count_records` row the operator believes is
            // gone, and the auditor is the one who will see it.
            console.error('soft delete failed', { recordId: record.serverId, error });
          });
        }
      }
      dispatch(event);
    },
    [operatorId, removeRecord],
  );

  /* --------------------------------------------------------------- recording */

  const onStartRecording = useCallback((): void => {
    const stream = streamRef.current;
    // No stream means consent never completed; the reducer's own guard has
    // already refused REC_STARTED, so there is nothing to undo here.
    if (stream === null || recorderRef.current !== null) return;
    const handle = openRecorder(stream);
    recorderRef.current = handle;
    handle.start();
  }, [openRecorder]);

  const onStopRecording = useCallback((): void => {
    const handle = recorderRef.current;
    if (handle === null) return;
    recorderRef.current = null;

    void (async () => {
      const audio = await handle.stop();

      // D10: refuse locally, BEFORE any upload. A 413 from the server must
      // never be the operator's first hint that the take was too long.
      if (exceedsSizeLimit(audio.blob)) {
        dispatch({ type: 'REC_REJECTED', reason: 'too_large' });
        return;
      }

      dispatch({ type: 'REC_STOPPED', audio });
      await runChain(audio);
    })();
  }, [runChain]);

  /* ----------------------------------------------------------- manual search */

  /**
   * D8: `no_match` and `ambiguous` share one sheet, and the mode is FROZEN when
   * it opens. Deriving it from the current candidate count instead would make
   * the heading flip from «Sin coincidencia exacta» to «Encontré varias
   * opciones» the moment a re-query returned rows, which reads as a bug.
   */
  const searchMode = useRef<'no_match' | 'ambiguous'>('no_match');
  const searchItem = state.overlay?.kind === 'search' ? state.overlay.item : null;
  const lastSearchItem = useRef(searchItem);
  if (searchItem !== null && searchItem !== lastSearchItem.current) {
    searchMode.current =
      state.overlay?.kind === 'search' && state.overlay.candidates.length > 0
        ? 'ambiguous'
        : 'no_match';
  }
  lastSearchItem.current = searchItem;

  const onSearchQueryChanged = useCallback(
    (query: string): void => {
      dispatch({ type: 'SEARCH_QUERY_CHANGED', query });

      const catalogueId = stateRef.current.catalogueId;
      if (catalogueId === null || query.trim() === '') return;

      // Last write wins: a slow earlier response must never overwrite the
      // results of what the operator is typing now.
      const seq = searchSeq.current + 1;
      searchSeq.current = seq;

      void (async () => {
        try {
          const response = await match({ spoken_name: query, catalogue_id: catalogueId });
          if (seq !== searchSeq.current) return;
          if (stateRef.current.overlay?.kind !== 'search') return;
          dispatch({ type: 'SEARCH_RESULTS', candidates: response.candidates });
        } catch {
          // A failed re-query leaves the previous candidates and the «Ninguno ·
          // volver a dictar» exit in place. Routing it to the error banner would
          // close the sheet and silently drop the item the operator is resolving.
        }
      })();
    },
    [match],
  );

  const onPick = useCallback((candidate: Candidate): void => {
    dispatch({ type: 'SEARCH_PICKED', candidate });
  }, []);

  /* -------------------------------------------------------------- rendering */

  if (state.screen === 'permiso') {
    return (
      <ConsentScreen
        state={state}
        dispatch={dispatch}
        operatorId={operatorId}
        persistConsent={persistConsent}
        requestMic={requestMic}
        onGranted={(stream) => {
          streamRef.current = stream;
        }}
      />
    );
  }

  if (state.screen === 'plans') {
    return (
      <PlansScreen
        dispatch={dispatch}
        operatorId={operatorId}
        loadPlans={loadPlans}
        {...(operatorName === undefined ? {} : { operatorName })}
      />
    );
  }

  if (state.screen === 'done') {
    return (
      <DoneScreen
        state={state}
        dispatch={dispatch}
        durationMs={startedAt === null || finishedAt === null ? 0 : finishedAt - startedAt}
      />
    );
  }

  const overlay = state.overlay;

  return (
    <>
      <CountScreen
        state={state}
        dispatch={dispatchWithEffects}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
      />

      {/* The failure surface. `UiError.message` is the English code by design,
          so only the authored Spanish map is ever rendered. */}
      {state.error === null ? null : (
        <div class="count__error" role="alert" data-testid="count-error">
          <p>{PIPELINE_ERROR_COPY[state.error.code]}</p>
          <button type="button" onClick={() => dispatch({ type: 'ERROR_DISMISSED' })}>
            Entendido
          </button>
        </div>
      )}

      {overlay?.kind === 'processing' ? <ProcessingSheet transcript={overlay.transcript} /> : null}

      {overlay?.kind === 'confirm' ? (
        <ConfirmSheet
          transcript={overlay.transcript}
          items={overlay.items}
          onConfirm={() => dispatch({ type: 'CONFIRM_ACCEPTED', at: now() })}
          onRepeat={() => dispatch({ type: 'CONFIRM_REPEAT' })}
        />
      ) : null}

      {overlay?.kind === 'anomaly' ? (
        <AnomalySheet
          item={overlay.item}
          anomaly={overlay.anomaly}
          onRedictate={() => dispatch({ type: 'ANOMALY_REDICTATE' })}
          onKeepNoted={() => dispatch({ type: 'ANOMALY_KEEP_NOTED', at: now() })}
        />
      ) : null}

      {overlay?.kind === 'search' ? (
        <SearchSheet
          mode={searchMode.current}
          item={overlay.item}
          query={overlay.query}
          candidates={overlay.candidates}
          onQueryChange={onSearchQueryChanged}
          onPick={onPick}
          onDismiss={() => dispatch({ type: 'SEARCH_DISMISSED' })}
          {...(searchDebounceMs === undefined ? {} : { debounceMs: searchDebounceMs })}
        />
      ) : null}
    </>
  );
}

export default CountSession;

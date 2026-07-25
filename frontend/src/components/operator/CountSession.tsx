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
 *     place `MockExtractionAdapter` (Module 2 seam) and `FixtureAnomalyEngine`
 *     (Module 4 seam) are named. Swapping either for a real service is a
 *     one-line change in this file and nowhere else;
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
import type { AnomalyEngine } from '../../lib/anomaly/engine';
import { match as realMatch, transcribe as realTranscribe } from '../../lib/api/client';
import { UiError } from '../../lib/api/types';
import type { Candidate, MatchFn, TranscribeFn } from '../../lib/api/types';
import { createRecorder, exceedsSizeLimit, requestMicrophone } from '../../lib/audio/capture';
import type { MicrophoneResult } from '../../lib/audio/capture';
import type { RecorderHandle } from '../../lib/audio/types';
import { mockExtractionAdapter } from '../../lib/extraction/mock';
import type { ExtractionAdapter } from '../../lib/extraction/adapter';
import { runPipeline, type PipelineDeps } from '../../lib/pipeline';
import { initialSessionState, sessionReducer } from '../../lib/session/reducer';
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
  anomalies?: AnomalyEngine;
  requestMic?: () => Promise<MicrophoneResult>;
  openRecorder?: (stream: MediaStream) => RecorderHandle;
  /** Injectable clock: the reducer has none and the summary needs one. */
  now?: () => number;
  /** Debounce applied to the manual-search re-query. */
  searchDebounceMs?: number;
  operatorName?: string;
  assignedCatalogueIds?: readonly string[];
}

/**
 * Anything that escapes the pipeline is already a `UiError`; this is the last
 * line of defence so an unexpected throw still reaches the operator as authored
 * Spanish instead of a blank screen.
 */
function toUiError(error: unknown): UiError {
  return error instanceof UiError ? error : new UiError('vendor_error');
}

export function CountSession({
  transcribe = realTranscribe,
  match = realMatch,
  extraction = mockExtractionAdapter,
  anomalies = fixtureAnomalyEngine,
  requestMic = requestMicrophone,
  openRecorder = createRecorder,
  now = Date.now,
  searchDebounceMs,
  operatorName,
  assignedCatalogueIds,
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

  /* ---------------------------------------------------------------- pipeline */

  const deps: PipelineDeps = useMemo(
    () => ({
      transcribe,
      extraction,
      match,
      anomalies,
      // The producer of `PIPELINE_TRANSCRIPT`: the S4 sheet shows what was heard
      // while the match calls are still in flight.
      onTranscript: (raw: string) => dispatch({ type: 'PIPELINE_TRANSCRIPT', raw }),
    }),
    [transcribe, extraction, match, anomalies],
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
        {...(operatorName === undefined ? {} : { operatorName })}
        {...(assignedCatalogueIds === undefined ? {} : { assignedCatalogueIds })}
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
        dispatch={dispatch}
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

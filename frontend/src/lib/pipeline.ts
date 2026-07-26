/**
 * The dictation pipeline: capture -> STT -> extract -> match -> outcome queue
 * (design §7, REQ-OCF-6, REQ-OCF-12, REQ-EXT-1).
 *
 * TWO OWNERS BY DESIGN:
 *   - T3 owns everything above `runPipeline` — the type surface, FROZEN.
 *   - T13 owns the `runPipeline` body only.
 * Never edit both concurrently.
 */
import type { AnomalyEngine, Anomaly } from './anomaly/engine';
import type { CapturedAudio } from './audio/types';
import { UiError } from './api/types';
import type { Candidate, MatchFn, MatchRequest, MatchResponse, TranscribeFn } from './api/types';
import type { ExtractedItem, ExtractionAdapter } from './extraction/adapter';

/** An extracted item that has been resolved to a concrete catalogue article. */
export interface ConfirmableItem {
  extracted: ExtractedItem;
  match: MatchResponse;
  /** `candidates[0]` for a `matched` response, or the operator's pick from the
   *  search sheet. Its `nr_articulo` / `unidad_display` may be null. */
  picked: Candidate;
}

/**
 * One unit of work for the operator, produced by the pipeline and consumed by
 * the session reducer. Ordering within `PipelineOutcome.queue` is always
 * anomalies -> searches -> confirmables; each resolution event pops the queue,
 * and once only confirmables remain they render as ONE combined confirm sheet.
 */
export type QueueEntry =
  | { kind: 'anomaly'; item: ConfirmableItem; anomaly: Anomaly }
  /** `ambiguous` AND `no_match` both land here (D8). `candidates` may be empty,
   *  in which case the search sheet issues live `match()` re-queries. */
  | { kind: 'needs_search'; item: ExtractedItem; candidates: Candidate[] }
  | { kind: 'confirmable'; item: ConfirmableItem };

export interface PipelineOutcome {
  /** The verbatim STT transcript, shown while processing and on the sheets. */
  transcript: string;
  queue: QueueEntry[];
}

/** The single swap point: every mock (extraction, anomalies) enters here. */
export interface PipelineDeps {
  transcribe: TranscribeFn;
  extraction: ExtractionAdapter;
  match: MatchFn;
  anomalies: AnomalyEngine;
  /**
   * OPTIONAL progressive-reveal hook, called the instant STT returns and before
   * anything is done with the transcript (T20 addition).
   *
   * `PIPELINE_TRANSCRIPT` was a producerless event: `runPipeline` resolved the
   * entire chain before returning, so the S4 processing sheet showed «Escuché»
   * with no text until resolution. The real STT worst case is
   * `STT_TOTAL_DEADLINE_S = 45`, so that is up to 45 s of blank sheet where the
   * design shows what the operator just said.
   *
   * It stays OPTIONAL on purpose: every existing caller and every existing test
   * builds `PipelineDeps` without it and is unaffected. It is deliberately NOT
   * called for garbage audio — there is nothing honest to reveal — but it IS
   * called before `nothing_extracted`, because in that case STT heard something
   * real and only the extraction found no quantity.
   */
  onTranscript?: (raw: string) => void;
}

/**
 * Build the matcher request for one extracted item.
 *
 * `unit` is OMITTED, never sent as `null` or `''`: the matcher treats an absent
 * unit as "unknown" and a present one as a filter, so an unresolved unit
 * (REQ-EXT-4, e.g. 'tablas') must not narrow the search at all.
 */
function toMatchRequest(item: ExtractedItem, catalogueId: string): MatchRequest {
  return {
    spoken_name: item.spokenName,
    catalogue_id: catalogueId,
    ...(item.unit !== null ? { unit: item.unit } : {}),
  };
}

/**
 * Transcribe the audio, extract N items, fan out to N PARALLEL match calls, and
 * recombine into ONE ordered queue.
 *
 * The whole chain is a single hop sequence:
 *   `CapturedAudio` -> `transcribe` -> raw transcript -> `extraction.extract`
 *   -> N items -> N concurrent `match` calls -> `anomalies.check` per matched
 *   item -> one `PipelineOutcome`.
 *
 * ONE outcome for N items is the point (RF-14): a three-item utterance must
 * produce a single confirm sheet, not three.
 *
 * Failure modes, all deliberate:
 *
 *   - `is_garbage: true` is a SIGNAL on a perfectly good HTTP 200, not a
 *     transport failure. The pipeline is where that signal becomes a verdict,
 *     because it is the only layer that knows the transcript is about to be fed
 *     to extraction. It surfaces as `UiError('garbage')` carrying the STT
 *     `request_id` — the same channel every other failure uses, so the UI shows
 *     one authored "no te entendí, repite" state instead of a second mechanism.
 *     The client below MUST NOT treat it as an error, and nothing here reads
 *     `stt_confidence` or `audio_duration_ms` to second-guess it.
 *   - `audio_duration_ms: null` and `stt_confidence: null` are NORMAL (chunked
 *     MediaRecorder blobs carry no duration header). They are never read, never
 *     coerced, and a `0` confidence is a real value, not garbage.
 *   - Zero extracted items raise `UiError('nothing_extracted')`. This is NOT
 *     defensive padding: `MockExtractionAdapter` silently drops any segment
 *     with no quantity or no article name, so 'tres kilos' or a stray
 *     "hola, buenos días" legitimately yields `[]`.
 *   - Every other error is a `UiError` from the client (413, 400, 502, 422,
 *     404, aborted, network) and propagates untouched. Nothing here catches,
 *     rewraps or downgrades one into a generic failure.
 */
export async function runPipeline(
  audio: CapturedAudio,
  catalogueId: string,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const stt = await deps.transcribe(audio);

  if (stt.is_garbage) throw new UiError('garbage', stt.request_id);

  const transcript = stt.raw_transcript;
  // Progressive reveal: hand the transcript over BEFORE extraction, so the S4
  // sheet fills in while the rest of the chain is still running.
  deps.onTranscript?.(transcript);

  const items = deps.extraction.extract(transcript);
  if (items.length === 0) throw new UiError('nothing_extracted', stt.request_id);

  // Fan out: N items, N concurrent requests, one await. A `for await` loop here
  // would make a three-item utterance three times slower than a one-item one.
  const matches = await Promise.all(
    items.map((item) => deps.match(toMatchRequest(item, catalogueId))),
  );

  // Classify. `anomalies.check` is AWAITED (design D4): the real engine asks
  // the server-side validation route, so the checks fan out in parallel for the
  // same reason the match calls do — a three-item utterance must not cost three
  // sequential round trips. `Promise.all` preserves extraction order.
  const classified = await Promise.all(
    items.map(async (extracted, i): Promise<QueueEntry> => {
      const match = matches[i]!;
      const picked = match.candidates[0];

      // `ambiguous` AND `no_match` both go to the search sheet (D8): a confident
      // wrong match is worse than asking. A `matched` with no candidate at all is
      // not a contract the matcher promises, but if it ever happens the operator
      // gets the search sheet instead of a crash.
      if (match.status !== 'matched' || picked === undefined) {
        return { kind: 'needs_search', item: extracted, candidates: match.candidates };
      }

      const item: ConfirmableItem = { extracted, match, picked };
      const anomaly = await deps.anomalies.check(item);
      return anomaly ? { kind: 'anomaly', item, anomaly } : { kind: 'confirmable', item };
    }),
  );

  // Recombine. Three buckets rather than one array + sort, so the ordering rule
  // is structural and extraction order survives inside each bucket.
  const anomalies = classified.filter((entry) => entry.kind === 'anomaly');
  const searches = classified.filter((entry) => entry.kind === 'needs_search');
  const confirmables = classified.filter((entry) => entry.kind === 'confirmable');

  // Anomalies -> searches -> confirmables (design §7). The reducer relies on
  // this exact order: once the head is a confirmable, every remaining entry is
  // too, which is what lets them recombine into ONE confirm sheet.
  return { transcript, queue: [...anomalies, ...searches, ...confirmables] };
}

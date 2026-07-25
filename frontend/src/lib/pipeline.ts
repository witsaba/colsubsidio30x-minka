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
import type { Candidate, MatchFn, MatchResponse, TranscribeFn } from './api/types';
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
}

/**
 * Transcribe the audio, extract N items, fan out to N PARALLEL match calls, and
 * recombine into an ordered queue.
 *
 * Throws `UiError('garbage')` when STT reports `is_garbage`, and
 * `UiError('nothing_extracted')` when extraction yields zero items.
 *
 * T13 implements — this stub exists only so the type surface can freeze now and
 * every dependent task can compile against it.
 */
export async function runPipeline(
  _audio: CapturedAudio,
  _catalogueId: string,
  _deps: PipelineDeps,
): Promise<PipelineOutcome> {
  throw new Error('not implemented');
}

/**
 * The Module 2 seam (REQ-EXT-1, REQ-EXT-5).
 *
 * FROZEN by T3, widened to `Promise` when the real extraction service landed.
 * Two adapters implement it: `HttpExtractionAdapter` (the production default)
 * and `MockExtractionAdapter` (test double and runtime fallback). No caller
 * changed, because the flow depends on this interface alone and the concrete
 * adapter is injected at exactly one swap point (`PipelineDeps`).
 */

export interface ExtractedItem {
  quantity: number;
  /**
   * The spoken unit word, or `null` when the utterance carried none. The
   * adapter never invents a unit: it emits only words the operator said
   * (REQ-EXT-4). Maps onto `MatchRequest.unit`.
   */
  unit: string | null;
  /** What the operator called the article. Maps onto `MatchRequest.spoken_name`. */
  spokenName: string;
}

export interface ExtractionAdapter {
  /**
   * Resolve the items an utterance carries (REQ-EXT-1).
   *
   * Asynchronous because the production adapter crosses the network. `await` on
   * a plain value is a no-op, so ONE signature serves both the HTTP adapter and
   * the offline mock — no union return type, no `Promise.resolve()` juggling in
   * the pipeline.
   *
   * Determinism (same transcript -> same items) is a MOCK-ONLY guarantee. The
   * real service runs an LLM consensus and may legitimately answer differently
   * for the same transcript; nothing may depend on repeatability here.
   */
  extract(rawTranscript: string): Promise<ExtractedItem[]>;
}

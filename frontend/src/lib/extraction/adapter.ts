/**
 * The Module 2 seam (REQ-EXT-1, REQ-EXT-5).
 *
 * FROZEN by T3. Tonight `MockExtractionAdapter` implements this; a real
 * extraction service later ships as another `ExtractionAdapter` and no caller
 * changes, because the flow depends on this interface alone and the concrete
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
  /** Deterministic: the same transcript always yields the same items. */
  extract(rawTranscript: string): ExtractedItem[];
}

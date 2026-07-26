/**
 * `withFallback` — per-utterance degradation to a second adapter (REQ-EXT-7).
 *
 * Composition rather than a try/catch inside the HTTP adapter: that would make
 * the HTTP adapter untestable in isolation and couple it to the mock. And not
 * inside `runPipeline` either — the pipeline's rule is that it never catches or
 * rewraps an error, and this is the one place that deliberately does.
 *
 * Deliberately absent:
 *
 *   - NO circuit breaker. Failure is judged per utterance, so one slow consensus
 *     does not pin the rest of the count to the mock (MVP; retry-next-utterance
 *     is the wanted demo behaviour).
 *   - NO operator-visible degraded indicator (recorded decision). A count that
 *     silently keeps working beats a badge nobody can act on mid-dictation.
 *
 * NOT triggered by an empty result: `[]` is a legitimate verdict from the
 * service and must reach the normal `nothing_extracted` («repite») path instead
 * of being second-guessed by a mock re-run.
 *
 * Rollback is one line at the call site: pass the mock directly again.
 */
import type { ExtractionAdapter } from './adapter';

export function withFallback(
  primary: ExtractionAdapter,
  fallback: ExtractionAdapter,
): ExtractionAdapter {
  return {
    async extract(rawTranscript: string) {
      try {
        return await primary.extract(rawTranscript);
      } catch (cause) {
        // The console is the only channel: surfacing this to the operator is
        // exactly what REQ-EXT-7 forbids.
        console.warn('[extraction] primary adapter failed, using the mock for this utterance', cause);
        return fallback.extract(rawTranscript);
      }
    },
  };
}

/**
 * Audio capture contracts (design §7).
 *
 * FROZEN by T3. Design §7 declared these inside `audio/capture.ts`, but both
 * the API client (T9) and the pipeline (T13) need `CapturedAudio` while
 * `capture.ts` is still T11's unwritten implementation. Splitting the types out
 * removes that ordering constraint; T11's `capture.ts` re-exports them so the
 * design's import path still works.
 */

export interface CapturedAudio {
  blob: Blob;
  /** The recorder's ACTUAL mimeType, read back from the MediaRecorder — not
   *  the type the caller asked for, which may have been unsupported. */
  mimeType: string;
  /** Measured by the LOCAL recording timer. Never STT's `audio_duration_ms`,
   *  which is nullable and may disagree (REQ-VC-6, REQ-OCF-7). */
  durationMs: number;
}

export interface RecorderHandle {
  start(): void;
  /** Resolves once the recorder has flushed its final chunk. */
  stop(): Promise<CapturedAudio>;
  /** Subscribe to the local elapsed-time timer that drives the mic dock. */
  onTick(cb: (elapsedMs: number) => void): void;
}

export interface RecorderOptions {
  /** Hard auto-stop. Default 20_000 ms — an unratified `[TEAM]` value (D10). */
  maxDurationMs?: number;
  /** Default 28_000, chosen so 20 s of opus stays under the 1 MiB guard. */
  audioBitsPerSecond?: number;
}

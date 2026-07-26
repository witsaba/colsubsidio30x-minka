/**
 * Push-to-talk microphone capture (REQ-VC-1..8, design §7, D10).
 *
 * Everything the browser can get wrong about a 20-second Opus dictation is
 * pinned here as ONE named constant each, so tuning is a one-line edit.
 */
import type { CapturedAudio, RecorderHandle, RecorderOptions } from './types';

// The design (§7) declares these next to `createRecorder`; T3 had to hoist them
// into `./types` so the API client and the pipeline did not have to wait on this
// file. Re-exported here to keep the design's import path working.
export type { CapturedAudio, RecorderHandle, RecorderOptions } from './types';

/* -------------------------------------------------------------------------- */
/* Constants (D10 — one named constant each)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hard client-side recording cap.
 *
 * `[TEAM]`: RF-13 requires a cap, but 20 s is a TEAM-proposed value that was
 * NEVER ratified by the client. Ratifying a different number must stay a
 * one-line change — do not inline this literal anywhere else.
 */
export const MAX_DURATION_MS = 20_000;

/**
 * Explicit Opus bitrate. Never leave `audioBitsPerSecond` unset: some Chromium
 * builds default to ~128 kbps, which crosses the 1 MiB STT ceiling in ~65 s.
 * At 28 kbps the 20 s cap yields ~70 KB — two orders of magnitude of headroom.
 */
export const AUDIO_BITS_PER_SECOND = 28_000;

/** The STT service's hard request ceiling, in bytes (1 MiB). */
export const MAX_BLOB_BYTES = 1_048_576;

/**
 * Container preference, in order (RNF-12). Firefox is the only browser that
 * actually produces OGG/Opus today; Chromium answers with WebM/Opus. Whatever
 * is chosen is read back off the recorder and surfaced on the capture, so the
 * real container is visible instead of being a demo-day surprise.
 */
export const MIME_PREFERENCE_CHAIN = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'] as const;

/** How often the local elapsed timer notifies the UI. */
const TICK_INTERVAL_MS = 100;

/* -------------------------------------------------------------------------- */
/* Microphone permission (REQ-VC-7)                                           */
/* -------------------------------------------------------------------------- */

export type MicrophoneResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * Requested from the consent screen's «Permitir el micrófono» button — NOT
 * lazily at the first recording, so an OS/browser denial is caught before the
 * count starts and routes to the manual fallback instead of erroring mid-count.
 *
 * Never throws: the caller dispatches MIC_GRANTED / MIC_DENIED off the result.
 */
export async function requestMicrophone(): Promise<MicrophoneResult> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) return { ok: false, reason: 'unavailable' };

  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    return { ok: true, stream };
  } catch (error) {
    const name = (error as Error | undefined)?.name;
    const denied = name === 'NotAllowedError' || name === 'SecurityError';
    return { ok: false, reason: denied ? 'denied' : 'unavailable' };
  }
}

/* -------------------------------------------------------------------------- */
/* Pre-upload size guard (REQ-VC-4)                                           */
/* -------------------------------------------------------------------------- */

/**
 * True when the capture must be refused locally. The server's 413 must never be
 * the operator's first signal that the dictation was too long.
 */
export function exceedsSizeLimit(blob: Blob): boolean {
  return blob.size > MAX_BLOB_BYTES;
}

/* -------------------------------------------------------------------------- */
/* Push-to-talk binding (REQ-VC-5 / RF-12)                                    */
/* -------------------------------------------------------------------------- */

export interface PushToTalkHandlers {
  onStart(): void;
  onStop(): void;
}

/**
 * Wires push-to-talk onto the mic control: `pointerdown` starts, `pointerup`
 * AND `pointerleave` stop. There is deliberately no toggle mode — holding is
 * the only way to record, and a finger sliding off the button ends the take.
 *
 * @returns a detach function that removes every listener.
 */
export function attachPushToTalk(element: HTMLElement, handlers: PushToTalkHandlers): () => void {
  let held = false;

  const down = (): void => {
    if (held) return; // Not a toggle: a repeat pointerdown is a no-op.
    held = true;
    handlers.onStart();
  };

  const up = (): void => {
    if (!held) return;
    held = false;
    handlers.onStop();
  };

  element.addEventListener('pointerdown', down);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointerleave', up);

  return () => {
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointerleave', up);
  };
}

/* -------------------------------------------------------------------------- */
/* Recorder                                                                   */
/* -------------------------------------------------------------------------- */

/** First supported container in the chain, or `undefined` for browser default. */
function pickMimeType(): string | undefined {
  const isSupported = globalThis.MediaRecorder?.isTypeSupported;
  if (typeof isSupported !== 'function') return undefined;
  return MIME_PREFERENCE_CHAIN.find((type) => isSupported(type));
}

/**
 * One handle records exactly one take. Nothing on this surface can cancel an
 * in-flight recording (REQ-VC-8): an anomaly raised for a previous record has
 * no way to reach in and discard the audio the operator is dictating now.
 */
export function createRecorder(stream: MediaStream, opts: RecorderOptions = {}): RecorderHandle {
  const maxDurationMs = opts.maxDurationMs ?? MAX_DURATION_MS;
  const audioBitsPerSecond = opts.audioBitsPerSecond ?? AUDIO_BITS_PER_SECOND;

  const listeners: ((elapsedMs: number) => void)[] = [];
  let recorder: MediaRecorder | null = null;
  let settled: Promise<CapturedAudio> | null = null;
  let startedAt = 0;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;

  /** Elapsed time from the LOCAL clock, clamped to the cap (REQ-VC-6). */
  const elapsedMs = (): number => Math.min(Date.now() - startedAt, maxDurationMs);

  const clearTimers = (): void => {
    if (tickTimer !== null) clearInterval(tickTimer);
    if (capTimer !== null) clearTimeout(capTimer);
    tickTimer = null;
    capTimer = null;
  };

  function start(): void {
    if (recorder !== null) return;

    const mimeType = pickMimeType();
    const options: MediaRecorderOptions = { audioBitsPerSecond };
    // Key stays ABSENT when nothing in the chain is supported — passing
    // `mimeType: undefined` makes some engines throw NotSupportedError.
    if (mimeType !== undefined) options.mimeType = mimeType;

    const active = new MediaRecorder(stream, options);
    recorder = active;
    startedAt = Date.now();

    const chunks: Blob[] = [];
    settled = new Promise<CapturedAudio>((resolve) => {
      active.ondataavailable = (event) => {
        if (event.data) chunks.push(event.data);
      };
      active.onstop = () => {
        const durationMs = elapsedMs();
        clearTimers();
        resolve({
          blob: new Blob(chunks, { type: active.mimeType }),
          // The recorder's ACTUAL container, not the one we asked for.
          mimeType: active.mimeType,
          durationMs,
        });
      };
    });

    active.start();

    tickTimer = setInterval(() => {
      const ms = elapsedMs();
      for (const listener of listeners) listener(ms);
    }, TICK_INTERVAL_MS);

    // Auto-stop, no pointerup required.
    capTimer = setTimeout(() => {
      if (active.state !== 'inactive') active.stop();
    }, maxDurationMs);
  }

  async function stop(): Promise<CapturedAudio> {
    if (recorder === null || settled === null) {
      throw new Error('createRecorder: stop() called before start()');
    }
    clearTimers();
    if (recorder.state !== 'inactive') recorder.stop();
    return settled;
  }

  function onTick(cb: (elapsedMs: number) => void): void {
    listeners.push(cb);
  }

  return { start, stop, onTick };
}

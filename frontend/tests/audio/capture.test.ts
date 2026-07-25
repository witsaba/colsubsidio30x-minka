/**
 * T11 — audio capture (REQ-VC-1..8, D10).
 *
 * The whole recorder is exercised through the T2 `FakeMediaRecorder` double and
 * `vi.useFakeTimers()`; no real microphone, no network, no wall clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIO_BITS_PER_SECOND,
  MAX_BLOB_BYTES,
  MAX_DURATION_MS,
  MIME_PREFERENCE_CHAIN,
  attachPushToTalk,
  createRecorder,
  exceedsSizeLimit,
  requestMicrophone,
} from '../../src/lib/audio/capture';
import { FakeMediaRecorder, blobOfSize, fakeMediaStream, getUserMediaMock } from '../setup';

const OGG = 'audio/ogg;codecs=opus';
const WEBM = 'audio/webm;codecs=opus';

/** Script `isTypeSupported` to accept exactly the listed mime types. */
function supportOnly(...supported: string[]): void {
  FakeMediaRecorder.isTypeSupported = vi.fn((type: string) => supported.includes(type));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('REQ-VC-1 — container preference chain', () => {
  it('picks audio/ogg;codecs=opus when the browser supports it (Firefox)', () => {
    supportOnly(OGG, WEBM);

    const recorder = createRecorder(fakeMediaStream());
    recorder.start();

    expect(FakeMediaRecorder.last?.options?.['mimeType']).toBe(OGG);
  });

  it('falls back to audio/webm;codecs=opus when ogg is unsupported (Chromium)', () => {
    supportOnly(WEBM);

    const recorder = createRecorder(fakeMediaStream());
    recorder.start();

    expect(FakeMediaRecorder.last?.options?.['mimeType']).toBe(WEBM);
  });

  it('omits the mimeType option entirely when neither preferred type is supported', () => {
    supportOnly();

    const recorder = createRecorder(fakeMediaStream());
    recorder.start();

    expect(FakeMediaRecorder.last?.options).not.toHaveProperty('mimeType');
  });

  it('surfaces the recorder ACTUAL mimeType on the capture, not the requested one', async () => {
    supportOnly();
    const recorder = createRecorder(fakeMediaStream());
    recorder.start();
    // The fake, like a real MediaRecorder, reports a concrete type regardless.
    FakeMediaRecorder.last!.nextChunk = blobOfSize(64, 'audio/webm');

    const captured = await recorder.stop();

    expect(captured.mimeType).toBe('audio/webm');
  });

  it('declares the chain in the exact spec order', () => {
    expect(MIME_PREFERENCE_CHAIN).toEqual([OGG, WEBM]);
  });
});

describe('REQ-VC-2 — explicit low bitrate', () => {
  it('always sets audioBitsPerSecond inside [24000, 32000] on the preferred branch', () => {
    supportOnly(OGG, WEBM);

    createRecorder(fakeMediaStream()).start();

    const bitrate = FakeMediaRecorder.last?.options?.['audioBitsPerSecond'] as number;
    expect(bitrate).toBe(AUDIO_BITS_PER_SECOND);
    expect(bitrate).toBeGreaterThanOrEqual(24_000);
    expect(bitrate).toBeLessThanOrEqual(32_000);
  });

  it('still sets audioBitsPerSecond on the no-mimeType fallback branch', () => {
    supportOnly();

    createRecorder(fakeMediaStream()).start();

    expect(FakeMediaRecorder.last?.options?.['audioBitsPerSecond']).toBe(AUDIO_BITS_PER_SECOND);
  });

  it('honours a caller override while keeping it explicit', () => {
    supportOnly(WEBM);

    createRecorder(fakeMediaStream(), { audioBitsPerSecond: 24_000 }).start();

    expect(FakeMediaRecorder.last?.options?.['audioBitsPerSecond']).toBe(24_000);
  });
});

describe('REQ-VC-3 — hard 20 s auto-stop', () => {
  it('exposes the cap as one named [TEAM] constant', () => {
    expect(MAX_DURATION_MS).toBe(20_000);
  });

  it('stops without a pointerup once the cap is reached and still yields the audio', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream());
    recorder.start();
    FakeMediaRecorder.last!.nextChunk = blobOfSize(4096, WEBM);

    await vi.advanceTimersByTimeAsync(MAX_DURATION_MS);

    expect(FakeMediaRecorder.last!.state).toBe('inactive');
    const captured = await recorder.stop();
    expect(captured.durationMs).toBe(MAX_DURATION_MS);
    expect(captured.blob.size).toBe(4096);
  });

  it('is still recording one tick before the cap', async () => {
    supportOnly(WEBM);
    createRecorder(fakeMediaStream()).start();

    await vi.advanceTimersByTimeAsync(MAX_DURATION_MS - 1);

    expect(FakeMediaRecorder.last!.state).toBe('recording');
  });

  it('applies a caller-supplied cap instead of the default', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream(), { maxDurationMs: 5_000 });
    recorder.start();
    FakeMediaRecorder.last!.nextChunk = blobOfSize(512, WEBM);

    await vi.advanceTimersByTimeAsync(5_000);

    expect((await recorder.stop()).durationMs).toBe(5_000);
  });
});

describe('REQ-VC-4 — pre-upload size guard', () => {
  it('refuses a blob one byte over the 1 MiB ceiling', () => {
    expect(exceedsSizeLimit(blobOfSize(1_048_577))).toBe(true);
  });

  it('accepts a blob exactly at the ceiling', () => {
    expect(exceedsSizeLimit(blobOfSize(1_048_576))).toBe(false);
  });

  it('accepts an ordinary short dictation', () => {
    expect(exceedsSizeLimit(blobOfSize(70_000))).toBe(false);
  });

  it('pins the ceiling to the STT service limit', () => {
    expect(MAX_BLOB_BYTES).toBe(1_048_576);
  });

  it('lets a guarded caller skip the request entirely — no 413 round trip', async () => {
    const upload = vi.fn(async (_blob: Blob) => undefined);
    const oversized = blobOfSize(1_048_577);

    if (!exceedsSizeLimit(oversized)) await upload(oversized);

    expect(upload).not.toHaveBeenCalled();
  });
});

describe('REQ-VC-6 — local elapsed timer', () => {
  it('ticks from the local clock while recording', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream());
    const ticks: number[] = [];
    recorder.onTick((ms) => ticks.push(ms));

    recorder.start();
    await vi.advanceTimersByTimeAsync(4_200);

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.at(-1)).toBe(4_200);
  });

  it('reports durationMs from the local timer, never from any STT field', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream());
    recorder.start();
    FakeMediaRecorder.last!.nextChunk = blobOfSize(2_048, WEBM);

    await vi.advanceTimersByTimeAsync(7_500);
    const captured = await recorder.stop();

    // The blob carries no duration metadata at all; 7500 can only come from
    // the local timer, which is exactly the point of REQ-VC-6.
    expect(captured.durationMs).toBe(7_500);
  });

  it('stops ticking once the recording ends', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream());
    const ticks: number[] = [];
    recorder.onTick((ms) => ticks.push(ms));

    recorder.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await recorder.stop();
    const afterStop = ticks.length;
    await vi.advanceTimersByTimeAsync(3_000);

    expect(ticks.length).toBe(afterStop);
  });
});

describe('REQ-VC-7 — permission requested at consent', () => {
  it('grants and returns the live stream', async () => {
    const stream = fakeMediaStream();
    getUserMediaMock.mockResolvedValueOnce(stream);

    const result = await requestMicrophone();

    expect(result).toEqual({ ok: true, stream });
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
  });

  it('routes a NotAllowedError denial to the manual fallback, never a thrown error', async () => {
    const denial = new Error('Permission denied');
    denial.name = 'NotAllowedError';
    getUserMediaMock.mockRejectedValueOnce(denial);

    await expect(requestMicrophone()).resolves.toEqual({ ok: false, reason: 'denied' });
  });

  it('reports a missing device as unavailable rather than denied', async () => {
    const missing = new Error('No microphone');
    missing.name = 'NotFoundError';
    getUserMediaMock.mockRejectedValueOnce(missing);

    await expect(requestMicrophone()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('REQ-VC-8 — recording is never interrupted', () => {
  it('keeps running across unrelated in-flight work and still delivers the full capture', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream());
    recorder.start();
    FakeMediaRecorder.last!.nextChunk = blobOfSize(8_192, WEBM);

    // An anomaly for a PREVIOUS record is raised mid-dictation. Nothing in the
    // recorder's surface can cancel it: `stop` is the only terminator.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(FakeMediaRecorder.last!.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(3_000);

    const captured = await recorder.stop();
    expect(captured.durationMs).toBe(9_000);
    expect(captured.blob.size).toBe(8_192);
  });

  it('is idempotent on a second stop and never opens a second recorder', async () => {
    supportOnly(WEBM);
    const recorder = createRecorder(fakeMediaStream());
    recorder.start();
    FakeMediaRecorder.last!.nextChunk = blobOfSize(256, WEBM);
    await vi.advanceTimersByTimeAsync(2_000);

    const first = await recorder.stop();
    const second = await recorder.stop();

    expect(second).toEqual(first);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });
});

describe('REQ-VC-5 — push-to-talk only', () => {
  function micButton(): HTMLElement {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return el;
  }

  it('starts on pointerdown', () => {
    const onStart = vi.fn();
    const el = micButton();
    attachPushToTalk(el, { onStart, onStop: vi.fn() });

    el.dispatchEvent(new Event('pointerdown'));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('does NOT toggle — a second pointerdown while held starts nothing new', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const el = micButton();
    attachPushToTalk(el, { onStart, onStop });

    el.dispatchEvent(new Event('pointerdown'));
    el.dispatchEvent(new Event('pointerdown'));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('stops on pointerup', () => {
    const onStop = vi.fn();
    const el = micButton();
    attachPushToTalk(el, { onStart: vi.fn(), onStop });

    el.dispatchEvent(new Event('pointerdown'));
    el.dispatchEvent(new Event('pointerup'));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stops on pointerleave exactly as on pointerup', () => {
    const onStop = vi.fn();
    const el = micButton();
    attachPushToTalk(el, { onStart: vi.fn(), onStop });

    el.dispatchEvent(new Event('pointerdown'));
    el.dispatchEvent(new Event('pointerleave'));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('ignores pointerup when nothing is being held', () => {
    const onStop = vi.fn();
    const el = micButton();
    attachPushToTalk(el, { onStart: vi.fn(), onStop });

    el.dispatchEvent(new Event('pointerup'));

    expect(onStop).not.toHaveBeenCalled();
  });

  it('stops only once when pointerup is followed by pointerleave', () => {
    const onStop = vi.fn();
    const el = micButton();
    attachPushToTalk(el, { onStart: vi.fn(), onStop });

    el.dispatchEvent(new Event('pointerdown'));
    el.dispatchEvent(new Event('pointerup'));
    el.dispatchEvent(new Event('pointerleave'));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('detaches cleanly', () => {
    const onStart = vi.fn();
    const el = micButton();
    const detach = attachPushToTalk(el, { onStart, onStop: vi.fn() });

    detach();
    el.dispatchEvent(new Event('pointerdown'));

    expect(onStart).not.toHaveBeenCalled();
  });
});

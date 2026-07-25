/**
 * Global test harness (design §11).
 *
 * happy-dom gives us `document`, `Blob` and `Response`, but it implements
 * neither `MediaRecorder` nor `navigator.mediaDevices`. Both are stubbed here
 * once, completely, so no test file has to reinvent them. `fetch` is stubbed
 * per-test through the helpers below — the suite never touches the network.
 *
 * Ownership: this file and `vitest.config.ts` belong to T2. Other tasks import
 * from here; they do not edit it.
 */
import { afterEach, beforeEach, vi } from 'vitest';

/* -------------------------------------------------------------------------- */
/* MediaRecorder                                                              */
/* -------------------------------------------------------------------------- */

export type RecorderState = 'inactive' | 'recording' | 'paused';

/**
 * Minimal, fully driveable MediaRecorder double.
 *
 * Tests control it through the statics: point `isTypeSupported` at whatever
 * mime chain they want to exercise, then reach for `FakeMediaRecorder.last` to
 * emit data or assert the constructor options the production code chose.
 */
export class FakeMediaRecorder {
  /** Every instance constructed since the last `resetMediaRecorder()`. */
  static instances: FakeMediaRecorder[] = [];

  /**
   * Overridden per test to script the mime negotiation chain, e.g.
   * `FakeMediaRecorder.isTypeSupported.mockImplementation(t => t.includes('webm'))`.
   * Defaults to accepting every type.
   */
  static isTypeSupported = vi.fn((_type: string) => true);

  /** The most recently constructed instance, or `null` if there is none. */
  static get last(): FakeMediaRecorder | null {
    return FakeMediaRecorder.instances.at(-1) ?? null;
  }

  readonly stream: unknown;
  readonly mimeType: string;
  readonly audioBitsPerSecond: number | undefined;
  /** The exact options object the production code passed to the constructor. */
  readonly options: Record<string, unknown> | undefined;

  state: RecorderState = 'inactive';

  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;

  constructor(stream: unknown, options?: Record<string, unknown>) {
    this.stream = stream;
    this.options = options;
    // A real MediaRecorder always reports a concrete mimeType, even when the
    // caller passed none — production code must read it back, never assume it.
    this.mimeType = (options?.['mimeType'] as string | undefined) ?? 'audio/webm';
    this.audioBitsPerSecond = options?.['audioBitsPerSecond'] as number | undefined;
    FakeMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number): void {
    this.state = 'recording';
    this.onstart?.(new Event('start'));
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: this.nextChunk ?? new Blob([''], { type: this.mimeType }) });
    this.onstop?.(new Event('stop'));
  }

  /** Blob handed to `ondataavailable` on the next `stop()`. Set it per test. */
  nextChunk: Blob | null = null;

  /** Emit a chunk without stopping (mirrors a `timeslice` recording). */
  emit(data: Blob): void {
    this.ondataavailable?.({ data });
  }
}

/** Build a Blob of exactly `bytes` length — used for the 1 MiB size guard. */
export function blobOfSize(bytes: number, type = 'audio/webm'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function resetMediaRecorder(): void {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported = vi.fn((_type: string) => true);
}

/* -------------------------------------------------------------------------- */
/* navigator.mediaDevices.getUserMedia                                        */
/* -------------------------------------------------------------------------- */

/** The shared getUserMedia mock. Resolves to a fake stream unless overridden. */
export const getUserMediaMock = vi.fn(async () => fakeMediaStream());

/** A stand-in MediaStream: enough surface for capture code to stop its tracks. */
export function fakeMediaStream(): MediaStream {
  const track = { kind: 'audio', stop: vi.fn(), enabled: true };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

/* -------------------------------------------------------------------------- */
/* fetch                                                                      */
/* -------------------------------------------------------------------------- */

/** A `fetch` stub that always answers with the same canned JSON response. */
export function stubFetchJson(body: unknown, init: ResponseInit = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => jsonResponse(body, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** A `fetch` stub driven by a handler, for per-URL or per-call scripting. */
export function stubFetchWith(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(handler);
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** A `fetch` stub that rejects, modelling an unreachable upstream. */
export function stubFetchRejecting(error: Error = new TypeError('fetch failed')): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => {
    throw error;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Canned JSON `Response`, defaulting to 200 with a JSON content type. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
  resetMediaRecorder();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockImplementation(async () => fakeMediaStream());

  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    mediaDevices: { getUserMedia: getUserMediaMock },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Typed browser client for the same-origin Astro proxy (design §8).
 *
 * Every call targets `/api/*` on the frontend origin. The Python services
 * (`:8001` STT, `:8002` matcher) are NEVER contacted directly from the browser:
 * that is what lets us ship without touching `services/` and without CORS
 * (REQ-PRX-1).
 *
 * Two invariants this module exists to protect:
 *
 * 1. **Nullability.** `stt_confidence`, `audio_duration_ms`, `nr_articulo`,
 *    `unidad` and `unidad_display` are `T | null` on the wire and stay `null`
 *    here. Success bodies are returned as parsed, with zero normalisation, so
 *    there is no code path that can coerce a null into `0` or `''`
 *    (REQ-OCF-7). `audio_duration_ms: null` in particular is the NORMAL case
 *    for chunked MediaRecorder blobs, which carry no duration header — elapsed
 *    time always comes from the local recording timer instead (REQ-VC-6).
 *
 * 2. **Error taxonomy.** Transport outcomes are collapsed into a single
 *    `UiError` carrying a `UiErrorCode` plus the upstream `request_id`, the
 *    correlation key across both services (REQ-PRX-2). Matcher 404 maps to
 *    `unknown_catalogue` and is deliberately kept distinct from the `no_match`
 *    *result status*: 404 is a configuration bug, `no_match` is a legitimate
 *    answer that opens the manual-search sheet.
 */
import type { CapturedAudio } from '../audio/types';
import {
  UiError,
  type CatalogueInfo,
  type MatchRequest,
  type MatchResponse,
  type TranscribeResponse,
  type UiErrorCode,
} from './types';

/* -------------------------------------------------------------------------- */
/* Timeout budgets (REQ-PRX-3)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Abort budget for `/api/transcribe`.
 *
 * The STT service's own worst case is 45 s (`STT_TOTAL_DEADLINE_S`), so this
 * MUST outlast it: the upstream deadline decides the outcome, never the
 * client. A 30 s budget would cut off legitimately slow vendor responses.
 */
export const TRANSCRIBE_TIMEOUT_MS = 50_000;

/**
 * Abort budget for `/api/match` and `/api/catalogues`.
 *
 * The matcher answers from an in-process sqlite catalogue with a p95 around
 * 1.8 ms, so 10 s is already three orders of magnitude of headroom.
 */
export const MATCH_TIMEOUT_MS = 10_000;

/* -------------------------------------------------------------------------- */
/* Endpoints — same-origin only                                               */
/* -------------------------------------------------------------------------- */

const TRANSCRIBE_URL = '/api/transcribe';
const MATCH_URL = '/api/match';
const CATALOGUES_URL = '/api/catalogues';

/* -------------------------------------------------------------------------- */
/* Error decoding                                                             */
/* -------------------------------------------------------------------------- */

/** The codes an upstream envelope may name that we trust verbatim. */
const ENVELOPE_CODES: ReadonlySet<string> = new Set<UiErrorCode>([
  'payload_too_large',
  'invalid_audio',
  'vendor_timeout',
  'vendor_error',
  'validation',
  'unknown_catalogue',
]);

/**
 * Status-only fallback, used when the body is unparseable or names a code we
 * do not recognise (an HTML gateway page, for instance).
 */
function codeForStatus(status: number): UiErrorCode {
  switch (status) {
    case 400:
      return 'invalid_audio';
    case 404:
      return 'unknown_catalogue';
    case 413:
      return 'payload_too_large';
    case 422:
      return 'validation';
    default:
      return 'vendor_error';
  }
}

interface DecodedError {
  code: UiErrorCode;
  requestId: string | undefined;
}

/**
 * Decode a non-2xx response into a `UiErrorCode` + `request_id`.
 *
 * Two body shapes exist and both must be handled:
 *  - the service envelope `{"error":{code,message,request_id}}` emitted by STT,
 *    the matcher and the proxy;
 *  - FastAPI's own validation shape `{"detail":[...]}`, which appears when a
 *    request never reaches handler code at all (e.g. the `file` field is
 *    missing). It carries NO request_id, and inventing one would be a lie.
 */
function decodeError(status: number, body: unknown): DecodedError {
  const fallback = codeForStatus(status);

  if (typeof body !== 'object' || body === null) {
    return { code: fallback, requestId: undefined };
  }

  const envelope = (body as { error?: unknown }).error;
  if (typeof envelope === 'object' && envelope !== null) {
    const { code, request_id: requestId } = envelope as {
      code?: unknown;
      request_id?: unknown;
    };
    return {
      code: typeof code === 'string' && ENVELOPE_CODES.has(code) ? (code as UiErrorCode) : fallback,
      requestId: typeof requestId === 'string' ? requestId : undefined,
    };
  }

  // FastAPI `{detail: ...}` — the status is the only signal available.
  return { code: fallback, requestId: undefined };
}

/** Parse a body defensively: a non-JSON error page must not mask the status. */
async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** `true` for both a caller `abort()` and an `AbortSignal.timeout` expiry. */
function isAbort(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Translate anything thrown by `fetch` itself. A rejected `fetch` means the
 * request never produced a response: either we aborted it, or the same-origin
 * proxy is unreachable (dev server down, offline).
 */
function transportError(error: unknown): UiError {
  if (error instanceof UiError) return error;
  return new UiError(isAbort(error) ? 'aborted' : 'proxy_unreachable');
}

/* -------------------------------------------------------------------------- */
/* Signal composition                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Compose the caller's signal with our own timeout so either can abort the
 * request. A caller signal that is ALREADY aborted short-circuits before any
 * network call is issued.
 */
function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (signal.aborted) throw new UiError('aborted');
  return AbortSignal.any([signal, timeout]);
}

/* -------------------------------------------------------------------------- */
/* Shared request path                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Issue one proxy request and return its parsed JSON body.
 *
 * The success body is returned exactly as parsed — no defaulting, no field
 * rewriting — which is what keeps every nullable wire field intact.
 *
 * Exported so `lib/api/operational.ts` reuses this exact error taxonomy and
 * timeout composition instead of growing a second, subtly different fetch path
 * for the Supabase-backed routes (design "File Changes").
 */
export async function request<T>(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: withTimeout(timeoutMs, signal) });
  } catch (error) {
    throw transportError(error);
  }

  if (!response.ok) {
    const { code, requestId } = decodeError(response.status, await readJsonSafely(response));
    throw new UiError(code, requestId);
  }

  try {
    return (await response.json()) as T;
  } catch {
    // A 2xx we cannot parse is an upstream contract break, not a user error.
    throw new UiError('vendor_error');
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Best-effort filename so the upstream multipart parser sees an extension. */
function filenameFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'audio.ogg';
  if (mimeType.includes('mp4')) return 'audio.mp4';
  return 'audio.webm';
}

/**
 * POST a capture to `/api/transcribe` as multipart field `file`.
 *
 * The `content-type` header is intentionally NOT set: the runtime must author
 * it so the multipart boundary matches the body.
 */
export async function transcribe(
  audio: CapturedAudio,
  opts?: { signal?: AbortSignal },
): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append('file', audio.blob, filenameFor(audio.mimeType));

  return request<TranscribeResponse>(
    TRANSCRIBE_URL,
    { method: 'POST', body: form },
    TRANSCRIBE_TIMEOUT_MS,
    opts?.signal,
  );
}

/**
 * POST a match request to `/api/match`.
 *
 * All three result statuses — `matched`, `ambiguous`, `no_match` — are normal
 * 200 responses returned to the caller untouched; only transport failures
 * throw. `unit` is omitted when extraction resolved none (REQ-EXT-4).
 */
export async function match(req: MatchRequest, opts?: { signal?: AbortSignal }): Promise<MatchResponse> {
  const body: MatchRequest = {
    spoken_name: req.spoken_name,
    catalogue_id: req.catalogue_id,
    ...(req.unit === undefined ? {} : { unit: req.unit }),
  };

  return request<MatchResponse>(
    MATCH_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    MATCH_TIMEOUT_MS,
    opts?.signal,
  );
}

/** GET the catalogue list from `/api/catalogues`. */
export async function getCatalogues(opts?: { signal?: AbortSignal }): Promise<CatalogueInfo[]> {
  return request<CatalogueInfo[]>(CATALOGUES_URL, { method: 'GET' }, MATCH_TIMEOUT_MS, opts?.signal);
}

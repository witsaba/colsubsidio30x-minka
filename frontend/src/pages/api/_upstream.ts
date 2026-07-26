/**
 * Shared plumbing for the four proxy endpoints (design §3, REQ-PRX-1..6).
 *
 * Why these endpoints exist at all: the Python services either ship no CORS or
 * ship a blanket `*`, so a browser must not call `:8001` / `:8002` / `:8003`
 * cross-origin — and none of them has auth, so exposing them publicly is not an
 * option either. Same-origin Astro routes solve both at once without touching
 * `services/`.
 *
 * The proxy decides NOTHING. It forwards, and it surfaces whatever the upstream
 * said — status and body untouched. Every mapping to UI semantics belongs to
 * the browser client (design §8).
 *
 * `_`-prefixed files are ignored by Astro's file-based router, so this module
 * never becomes a route.
 */

/**
 * Documented defaults (REQ-PRX-5). Overridable via env, never via request.
 *
 * These ARE the documentation: the repo ships no `frontend/.env.example`, and
 * compose supplies the in-network values (`EXTRACTOR_BASE_URL:
 * http://product_identification:8003`). Running the frontend bare against a
 * locally started stack needs no env at all.
 */
export const STT_BASE_DEFAULT = 'http://localhost:8001';
export const MATCHER_BASE_DEFAULT = 'http://localhost:8002';
export const EXTRACTOR_BASE_DEFAULT = 'http://localhost:8003';

/**
 * STT's worst case is `STT_TOTAL_DEADLINE_S = 45 s`. The proxy budget must
 * outlast it so the service's own 502 arrives first and the caller sees a real
 * vendor verdict instead of a proxy-invented timeout (REQ-PRX-3, RNF-02).
 */
export const TRANSCRIBE_TIMEOUT_MS = 50_000;
export const MATCH_TIMEOUT_MS = 10_000;

/**
 * The extractor runs a dual-Gemini consensus and ships NO server-side deadline
 * of its own, so this abort is the only backstop the caller has. It cannot
 * reuse `MATCH_TIMEOUT_MS`: 10 s is tuned for an in-process sqlite lookup,
 * while a legitimate consensus routinely runs tens of seconds (REQ-PRX-6).
 */
export const EXTRACT_TIMEOUT_MS = 60_000;

function base(envValue: string | undefined, fallback: string): string {
  return (envValue ?? fallback).replace(/\/+$/, '');
}

/**
 * Bases are resolved per call so the value is read from the running process's
 * environment. They are derived ONLY from env: no part of the request may ever
 * influence the target URL (SSRF guard, REQ-PRX-5).
 */
export function sttBase(): string {
  return base(process.env.STT_BASE_URL, STT_BASE_DEFAULT);
}

export function matcherBase(): string {
  return base(process.env.MATCHER_BASE_URL, MATCHER_BASE_DEFAULT);
}

export function extractorBase(): string {
  return base(process.env.EXTRACTOR_BASE_URL, EXTRACTOR_BASE_DEFAULT);
}

/** The error envelope both services emit; the proxy reproduces its shape. */
function serviceError(code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Re-emit the upstream response verbatim: same status, same bytes, streamed.
 * Only `content-type` and `x-request-id` are carried over — hop-by-hop and
 * length headers must not be copied onto a re-streamed body.
 */
function passThrough(upstream: Response): Response {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const requestId = upstream.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);

  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * Run one upstream call and normalise only the transport failure case.
 *
 * A thrown `fetch` (service down, DNS failure, abort) is the single situation
 * where no upstream verdict exists, so the proxy synthesises the STT envelope
 * with `proxy_unreachable` (design §3). Everything else — 4xx, 5xx, malformed
 * JSON — is the upstream's answer and is passed through untouched.
 */
export async function forward(url: string, init: RequestInit): Promise<Response> {
  try {
    return passThrough(await fetch(url, init));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return serviceError('proxy_unreachable', `No se pudo contactar el servicio upstream: ${message}`);
  }
}

/**
 * Forward the inbound body as a stream.
 *
 * `duplex: 'half'` is required by undici whenever the body is a
 * `ReadableStream`. Passing `request.body` through means the audio bytes are
 * never buffered into a string and never spooled to disk (REQ-PRX-4, RNF-04) —
 * the same property the STT service proves on its own side.
 */
export function streamBody(request: Request): Pick<RequestInit, 'body'> & { duplex: 'half' } {
  return { body: request.body, duplex: 'half' };
}

/** Copy only the content-type: the multipart boundary lives in it. */
export function contentTypeOf(request: Request): Record<string, string> {
  const contentType = request.headers.get('content-type');
  return contentType ? { 'content-type': contentType } : {};
}

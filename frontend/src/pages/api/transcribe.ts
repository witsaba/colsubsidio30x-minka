import type { APIRoute } from 'astro';

import {
  TRANSCRIBE_TIMEOUT_MS,
  contentTypeOf,
  forward,
  streamBody,
  sttBase,
} from './_upstream';

/** Server-rendered: this route proxies, it is never built to a static file. */
export const prerender = false;

/**
 * `POST /api/transcribe` → `STT_BASE_URL/transcribe` (REQ-PRX-1).
 *
 * Multipart passthrough with the field name `file`, exactly as the browser sent
 * it — the request stream and its boundary are forwarded untouched, so the
 * audio never lands on disk (REQ-PRX-4).
 *
 * The proxy applies no size check of its own: a payload over STT's 1 MiB
 * ceiling must come back as the service's own 413 `payload_too_large`, not as a
 * verdict this layer invented (REQ-PRX-2).
 */
export const POST: APIRoute = async ({ request }) =>
  forward(`${sttBase()}/transcribe`, {
    method: 'POST',
    headers: contentTypeOf(request),
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    ...streamBody(request),
  });

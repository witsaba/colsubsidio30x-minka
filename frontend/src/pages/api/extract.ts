import type { APIRoute } from 'astro';

import { EXTRACT_TIMEOUT_MS, contentTypeOf, extractorBase, forward, streamBody } from './_upstream';

export const prerender = false;

/**
 * `POST /api/extract` → `EXTRACTOR_BASE_URL/api/v1/extract` (REQ-PRX-1).
 *
 * The `{transcription}` body is forwarded verbatim and the consensus response
 * comes back untouched — `consensus_status` and `confidence_score` included,
 * even though the MVP client reads only `validated_inventory`. Projecting the
 * fields we happen to use today would silently break the next consumer.
 *
 * The extractor DOES ship CORS `*`, so a direct browser call would technically
 * work. It still goes through here: `:8003` has no auth, and keeping every
 * upstream behind the frontend origin is what lets the demo host publish one
 * port (REQ-PRX-1).
 */
export const POST: APIRoute = async ({ request }) =>
  forward(`${extractorBase()}/api/v1/extract`, {
    method: 'POST',
    headers: contentTypeOf(request),
    signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    ...streamBody(request),
  });

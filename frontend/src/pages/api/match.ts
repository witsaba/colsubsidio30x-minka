import type { APIRoute } from 'astro';

import { MATCH_TIMEOUT_MS, contentTypeOf, forward, matcherBase, streamBody } from './_upstream';

export const prerender = false;

/**
 * `POST /api/match` → `MATCHER_BASE_URL/match` (REQ-PRX-1).
 *
 * The JSON body is forwarded verbatim; the proxy never inspects or rewrites it.
 * In particular a 404 for an unknown `catalogue_id` stays a 404 — remapping it
 * to `no_match` would hide a configuration bug behind a normal business
 * outcome (REQ-PRX-2).
 */
export const POST: APIRoute = async ({ request }) =>
  forward(`${matcherBase()}/match`, {
    method: 'POST',
    headers: contentTypeOf(request),
    signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
    ...streamBody(request),
  });

import type { APIRoute } from 'astro';

import { MATCH_TIMEOUT_MS, forward, matcherBase } from './_upstream';

export const prerender = false;

/** `GET /api/catalogues` → `MATCHER_BASE_URL/catalogues` (REQ-PRX-1). */
export const GET: APIRoute = async () =>
  forward(`${matcherBase()}/catalogues`, {
    method: 'GET',
    signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
  });

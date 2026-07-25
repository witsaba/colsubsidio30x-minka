import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * `GET /health` — liveness, and nothing more.
 *
 * Every service in the root docker-compose.yml answers `/health`: the Compose
 * healthcheck probes it from inside the container and scripts/smoke-compose.sh
 * probes it again from the host. The frontend is a service in that file, so it
 * owes the same route and the same `{"status":"ok"}` envelope the two Python
 * services emit.
 *
 * Deliberately NOT a readiness check: it never contacts stt or matcher. The
 * frontend stays useful when an upstream is down — the proxies surface
 * `proxy_unreachable` per request (see api/_upstream.ts) — and folding an
 * upstream's health into this route would let one service's outage restart a
 * container that is working, which is exactly the cross-service coupling
 * REQ-UCD-4 forbids.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

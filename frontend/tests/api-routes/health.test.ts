/**
 * `GET /health` — the liveness endpoint the deployment contract requires.
 *
 * Every service in the root docker-compose.yml is probed at `/health`: the
 * Compose healthcheck does it, and scripts/smoke-compose.sh does it again from
 * outside. The frontend is a service in that file, so it owes the same route.
 *
 * The contract is deliberately the narrowest one that is still true: "this
 * process is up and serving". It must NOT reach for stt or matcher — a
 * frontend that stays useful while an upstream is down (the proxies already
 * surface `proxy_unreachable` per-request) must not be restarted by Compose
 * because of that upstream.
 */
import { describe, expect, it, vi } from 'vitest';

import { GET, prerender } from '../../src/pages/health';

/** Astro hands the route an APIContext; this endpoint reads nothing from it. */
function ctx(): any {
  return { request: new Request('http://localhost:4321/health') };
}

describe('GET /health', () => {
  it('is server-rendered, not prerendered to a static file', () => {
    // A prerendered page would answer from disk and prove nothing about the
    // running process.
    expect(prerender).toBe(false);
  });

  it('answers 200 with the same {"status":"ok"} envelope the services use', async () => {
    const response = await GET(ctx());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('never contacts an upstream service', async () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as never;
    try {
      await GET(ctx());
    } finally {
      globalThis.fetch = original;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

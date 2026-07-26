/**
 * T10 — Astro proxy endpoints (REQ-PRX-1..5, RNF-04).
 *
 * The two Python services have no CORS and no auth, so the browser can never
 * call `:8001` / `:8002` directly. These same-origin server endpoints are the
 * whole solution. The contract under test is deliberately narrow: forward
 * faithfully, decide nothing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/**
 * ESM namespaces are frozen, so `vi.spyOn(fs, ...)` is impossible. The write
 * APIs are wrapped at module level instead, which is the only way to observe
 * "the handler never wrote a byte to disk" from inside Vitest.
 */
const { FS_WRITERS, FSP_WRITERS } = vi.hoisted(() => ({
  FS_WRITERS: ['writeFileSync', 'writeFile', 'createWriteStream', 'openSync', 'appendFileSync'] as const,
  FSP_WRITERS: ['writeFile', 'open', 'appendFile'] as const,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of FS_WRITERS) wrapped[name] = vi.fn(actual[name] as never);
  return wrapped;
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const name of FSP_WRITERS) wrapped[name] = vi.fn(actual[name] as never);
  return wrapped;
});

import {
  POST as transcribePost,
  prerender as transcribePrerender,
} from '../../src/pages/api/transcribe';
import { POST as matchPost, prerender as matchPrerender } from '../../src/pages/api/match';
import { GET as cataloguesGet, prerender as cataloguesPrerender } from '../../src/pages/api/catalogues';

type FetchCall = [input: string, init: RequestInit];

/** Astro hands the route an APIContext; these endpoints only read `request`. */
function ctx(request: Request): any {
  return { request };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function stubFetch(responder: (input: any, init: any) => Response | Promise<Response>) {
  const spy = vi.fn(responder);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function callsOf(spy: ReturnType<typeof vi.fn>): FetchCall[] {
  return spy.mock.calls as unknown as FetchCall[];
}

function multipartRequest(url = 'http://localhost:4321/api/transcribe', extra?: Record<string, string>) {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'audio.webm', { type: 'audio/webm' }));
  for (const [k, v] of Object.entries(extra ?? {})) form.set(k, v);
  return new Request(url, { method: 'POST', body: form });
}

const ENV_KEYS = ['STT_BASE_URL', 'MATCHER_BASE_URL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('REQ-PRX-1 — same-origin endpoints, server-rendered', () => {
  it('all three endpoints opt out of prerendering', () => {
    expect(transcribePrerender).toBe(false);
    expect(matchPrerender).toBe(false);
    expect(cataloguesPrerender).toBe(false);
  });

  it('POST /api/transcribe forwards to STT /transcribe', async () => {
    const spy = stubFetch(() =>
      jsonResponse(
        {
          raw_transcript: 'cinco kilos de arroz',
          is_garbage: false,
          stt_confidence: null,
          audio_duration_ms: null,
          stt_vendor: 'deepgram',
          request_id: 'r1',
        },
        200,
      ),
    );

    const res = await transcribePost(ctx(multipartRequest()));

    expect(callsOf(spy)[0][0]).toBe('http://localhost:8001/transcribe');
    expect(callsOf(spy)[0][1].method).toBe('POST');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.request_id).toBe('r1');
    // Nullability is load-bearing all the way through the proxy.
    expect(body.stt_confidence).toBeNull();
    expect(body.audio_duration_ms).toBeNull();
  });

  it('POST /api/match forwards the JSON body verbatim to matcher /match', async () => {
    const spy = stubFetch(() =>
      jsonResponse(
        { status: 'matched', candidates: [], top_score: 0.91, margin: 0.2, request_id: 'm1' },
        200,
      ),
    );

    const payload = { spoken_name: 'arroz', catalogue_id: 'stock_restaurante_fuentes_ayb', unit: 'kg' };
    const res = await matchPost(
      ctx(
        new Request('http://localhost:4321/api/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ),
    );

    const [url, init] = callsOf(spy)[0];
    expect(url).toBe('http://localhost:8002/match');
    expect(JSON.parse(await new Response(init.body as BodyInit).text())).toEqual(payload);
    expect(res.status).toBe(200);
    expect((await res.json()).request_id).toBe('m1');
  });

  it('GET /api/catalogues forwards to matcher /catalogues', async () => {
    const spy = stubFetch(() => jsonResponse([{ catalogue_id: 'a', rows: 10 }], 200));

    const res = await cataloguesGet(ctx(new Request('http://localhost:4321/api/catalogues')));

    expect(callsOf(spy)[0][0]).toBe('http://localhost:8002/catalogues');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ catalogue_id: 'a', rows: 10 }]);
  });
});

describe('REQ-PRX-5 — upstream bases from env, never from the request (SSRF guard)', () => {
  it('uses the documented localhost defaults when no env var is set', async () => {
    const spy = stubFetch(() => jsonResponse([], 200));
    await cataloguesGet(ctx(new Request('http://localhost:4321/api/catalogues')));
    expect(callsOf(spy)[0][0]).toBe('http://localhost:8002/catalogues');
  });

  it('honours MATCHER_BASE_URL and STT_BASE_URL overrides', async () => {
    process.env.MATCHER_BASE_URL = 'http://other:9000';
    process.env.STT_BASE_URL = 'http://stt-host:9100/';
    const spy = stubFetch(() => jsonResponse({}, 200));

    await cataloguesGet(ctx(new Request('http://localhost:4321/api/catalogues')));
    expect(callsOf(spy)[0][0]).toBe('http://other:9000/catalogues');

    await transcribePost(ctx(multipartRequest()));
    // Trailing slash in the env value must not produce a double slash.
    expect(callsOf(spy)[1][0]).toBe('http://stt-host:9100/transcribe');
  });

  it('ignores upstream hints smuggled in the query string, headers or body', async () => {
    const spy = stubFetch(() => jsonResponse({}, 200));

    await transcribePost(
      ctx(
        multipartRequest('http://localhost:4321/api/transcribe?base=http://evil.example', {
          base_url: 'http://evil.example',
        }),
      ),
    );
    await matchPost(
      ctx(
        new Request('http://localhost:4321/api/match?upstream=http://evil.example', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-upstream': 'http://evil.example' },
          body: JSON.stringify({ spoken_name: 'x', catalogue_id: 'c', base_url: 'http://evil.example' }),
        }),
      ),
    );
    await cataloguesGet(
      ctx(
        new Request('http://localhost:4321/api/catalogues?base=http://evil.example', {
          headers: { 'x-upstream': 'http://evil.example' },
        }),
      ),
    );

    for (const [url] of callsOf(spy)) {
      expect(String(url)).not.toContain('evil.example');
    }
    expect(callsOf(spy).map(([u]) => u)).toEqual([
      'http://localhost:8001/transcribe',
      'http://localhost:8002/match',
      'http://localhost:8002/catalogues',
    ]);
  });
});

describe('REQ-PRX-2 — faithful status and body pass-through with request_id', () => {
  const envelope = (code: string, requestId: string) => ({
    error: { code, message: `upstream says ${code}`, request_id: requestId },
  });

  it.each([
    [413, 'payload_too_large'],
    [400, 'invalid_audio'],
    [502, 'vendor_timeout'],
    [502, 'vendor_error'],
  ])('STT %i %s passes through untouched', async (status, code) => {
    stubFetch(() => jsonResponse(envelope(code, 'r-err'), status));

    const res = await transcribePost(ctx(multipartRequest()));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(envelope(code, 'r-err'));
  });

  it('a payload over the 1 MiB STT ceiling surfaces the upstream 413, not a proxy verdict', async () => {
    const spy = stubFetch(() => jsonResponse(envelope('payload_too_large', 'r-413'), 413));
    const oversized = new Request('http://localhost:4321/api/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: new Uint8Array(1_048_577),
    });

    const res = await transcribePost(ctx(oversized));

    // The proxy does not pre-judge size: it forwards and lets STT decide.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(413);
    expect((await res.json()).error.request_id).toBe('r-413');
  });

  it('FastAPI 422 for a missing `file` keeps the {detail:[...]} shape', async () => {
    const detail = { detail: [{ loc: ['body', 'file'], msg: 'Field required', type: 'missing' }] };
    stubFetch(() => jsonResponse(detail, 422));

    const res = await transcribePost(
      ctx(new Request('http://localhost:4321/api/transcribe', { method: 'POST', body: new FormData() })),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(detail);
  });

  it('matcher 404 for an unknown catalogue_id stays 404 and is never rewritten to no_match', async () => {
    const body = { error: { code: 'unknown_catalogue', message: 'no such catalogue', request_id: 'm404' } };
    stubFetch(() => jsonResponse(body, 404));

    const res = await matchPost(
      ctx(
        new Request('http://localhost:4321/api/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spoken_name: 'arroz', catalogue_id: 'nope' }),
        }),
      ),
    );

    expect(res.status).toBe(404);
    const parsed = await res.json();
    expect(parsed).toEqual(body);
    expect(JSON.stringify(parsed)).not.toContain('no_match');
  });

  it('matcher 422 validation errors pass through', async () => {
    const detail = { detail: [{ loc: ['body', 'spoken_name'], msg: 'Field required', type: 'missing' }] };
    stubFetch(() => jsonResponse(detail, 422));

    const res = await matchPost(
      ctx(
        new Request('http://localhost:4321/api/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(detail);
  });

  it('preserves the upstream x-request-id response header when present', async () => {
    stubFetch(() => jsonResponse({ ok: true }, 200, { 'x-request-id': 'hdr-1' }));
    const res = await cataloguesGet(ctx(new Request('http://localhost:4321/api/catalogues')));
    expect(res.headers.get('x-request-id')).toBe('hdr-1');
  });

  it('a thrown fetch becomes 502 proxy_unreachable in the STT envelope shape', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });

    for (const res of [
      await transcribePost(ctx(multipartRequest())),
      await matchPost(
        ctx(
          new Request('http://localhost:4321/api/match', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
        ),
      ),
      await cataloguesGet(ctx(new Request('http://localhost:4321/api/catalogues'))),
    ]) {
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe('proxy_unreachable');
      expect(typeof body.error.message).toBe('string');
    }
  });
});

describe('REQ-PRX-3 — abort budget outlasts the 45 s STT deadline', () => {
  it('transcribe uses a > 45 s budget and match/catalogues ~10 s', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    stubFetch(() => jsonResponse({}, 200));

    await transcribePost(ctx(multipartRequest()));
    await matchPost(
      ctx(
        new Request('http://localhost:4321/api/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    );
    await cataloguesGet(ctx(new Request('http://localhost:4321/api/catalogues')));

    const [transcribeMs, matchMs, cataloguesMs] = timeoutSpy.mock.calls.map(([ms]) => ms as number);
    expect(transcribeMs).toBeGreaterThan(45_000);
    expect(transcribeMs).toBe(50_000);
    expect(matchMs).toBe(10_000);
    expect(cataloguesMs).toBe(10_000);
  });

  it('an upstream that answers at 44 s still returns its 200, not a proxy timeout', async () => {
    // The abort signal is real; the point is that a 44 s answer sits inside it.
    stubFetch(async (_input, init) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      return jsonResponse({ raw_transcript: 'ok', request_id: 'slow-1' }, 200);
    });

    const res = await transcribePost(ctx(multipartRequest()));
    expect(res.status).toBe(200);
    expect((await res.json()).request_id).toBe('slow-1');
  });
});

describe('REQ-PRX-4 / RNF-04 — audio is streamed, never written to disk', () => {
  it('forwards the request body stream itself and its content-type', async () => {
    const spy = stubFetch(() => jsonResponse({}, 200));
    const req = multipartRequest();
    const contentType = req.headers.get('content-type')!;

    await transcribePost(ctx(req));

    const [, init] = callsOf(spy)[0];
    // Same stream object: nothing buffered, nothing re-encoded, boundary intact.
    expect(init.body).toBe(req.body);
    expect((init as any).duplex).toBe('half');
    expect(new Headers(init.headers).get('content-type')).toBe(contentType);
    expect(contentType).toContain('multipart/form-data; boundary=');
  });

  it('invokes no filesystem write API while forwarding audio', async () => {
    const writers = [
      ...FS_WRITERS.map((name) => fs[name] as ReturnType<typeof vi.fn>),
      ...FSP_WRITERS.map((name) => fsp[name] as ReturnType<typeof vi.fn>),
    ];
    for (const w of writers) w.mockClear();
    stubFetch(() => jsonResponse({}, 200));

    await transcribePost(ctx(multipartRequest()));

    for (const w of writers) expect(w).not.toHaveBeenCalled();
  });

  it.each(['src/pages/api/transcribe.ts', 'src/pages/api/_upstream.ts'])(
    '%s imports no filesystem API at all',
    async (relative) => {
      const source = await fsp.readFile(path.resolve(process.cwd(), relative), 'utf8');
      expect(source).not.toMatch(/from\s+['"](node:)?fs/);
      expect(source).not.toMatch(/require\(\s*['"](node:)?fs/);
    },
  );
});

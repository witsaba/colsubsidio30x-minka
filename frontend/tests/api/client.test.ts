/**
 * T9 — typed API client and error taxonomy (design §8, REQ-PRX-2/3, REQ-OCF-7).
 *
 * Every call goes to the SAME-ORIGIN Astro proxy (`/api/*`), never to the
 * Python services. `fetch` is stubbed by the T2 harness.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  MATCH_TIMEOUT_MS,
  TRANSCRIBE_TIMEOUT_MS,
  getCatalogues,
  match,
  transcribe,
} from '../../src/lib/api/client';
import { UiError } from '../../src/lib/api/types';
import type { CapturedAudio } from '../../src/lib/audio/types';
import { jsonResponse, stubFetchJson, stubFetchRejecting, stubFetchWith } from '../setup';

function audio(overrides: Partial<CapturedAudio> = {}): CapturedAudio {
  return {
    blob: new Blob([new Uint8Array(16)], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationMs: 3_200,
    ...overrides,
  };
}

/** The STT/matcher error envelope both services emit. */
function envelope(code: string, requestId = 'req-1'): unknown {
  return { error: { code, message: `upstream says ${code}`, request_id: requestId } };
}

/** Assert a rejection is a UiError with the expected code (and request id). */
async function expectUiError(
  promise: Promise<unknown>,
  code: string,
  requestId?: string,
): Promise<UiError> {
  const err = await promise.then(
    () => {
      throw new Error('expected the call to reject, but it resolved');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(UiError);
  const uiError = err as UiError;
  expect(uiError.code).toBe(code);
  if (requestId !== undefined) expect(uiError.requestId).toBe(requestId);
  return uiError;
}

/* -------------------------------------------------------------------------- */
/* transcribe — success and nullability                                       */
/* -------------------------------------------------------------------------- */

describe('transcribe', () => {
  it('POSTs multipart to the same-origin proxy with the file field', async () => {
    const fetchMock = stubFetchJson({
      raw_transcript: 'tres kilos de lechuga batavia',
      is_garbage: false,
      stt_confidence: 0.92,
      audio_duration_ms: 3210,
      stt_vendor: 'deepgram',
      request_id: 'r-ok',
    });

    await transcribe(audio());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Same-origin proxy only — never the Python service directly.
    expect(url).toBe('/api/transcribe');
    expect(String(url)).not.toContain('8001');
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(Blob);
    // A hand-set multipart content-type would break the boundary.
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves stt_confidence: null instead of coercing it to 0', async () => {
    stubFetchJson({
      raw_transcript: 'doce botellas de aceite vegetal',
      is_garbage: false,
      stt_confidence: null,
      audio_duration_ms: 4100,
      stt_vendor: 'groq',
      request_id: 'r-null-conf',
    });

    const res = await transcribe(audio());

    expect(res.stt_confidence).toBeNull();
    expect(res.stt_confidence).not.toBe(0);
  });

  it('preserves audio_duration_ms: null — the normal case for chunked MediaRecorder blobs', async () => {
    // MediaRecorder chunks carry no duration header, so STT legitimately
    // reports null. It must never be read as garbage or turned into 0.
    stubFetchJson({
      raw_transcript: 'novecientos gramos de aceite de oliva extra virgen',
      is_garbage: false,
      stt_confidence: 0.81,
      audio_duration_ms: null,
      stt_vendor: 'deepgram',
      request_id: 'r-null-dur',
    });

    const res = await transcribe(audio({ durationMs: 5_000 }));

    expect(res.audio_duration_ms).toBeNull();
    expect(res.audio_duration_ms).not.toBe(0);
    expect(res.is_garbage).toBe(false);
    // Elapsed time comes from the local recorder timer, never from the wire.
    expect(res).not.toHaveProperty('durationMs');
  });

  it('surfaces request_id on the success path for cross-service correlation', async () => {
    stubFetchJson({
      raw_transcript: 'dos cajas de tomate chonto',
      is_garbage: false,
      stt_confidence: null,
      audio_duration_ms: null,
      stt_vendor: 'deepgram',
      request_id: 'r-correlate',
    });

    const res = await transcribe(audio());

    expect(res.request_id).toBe('r-correlate');
  });

  it('returns is_garbage: true untouched — the pipeline, not the client, decides', async () => {
    stubFetchJson({
      raw_transcript: '',
      is_garbage: true,
      stt_confidence: null,
      audio_duration_ms: null,
      stt_vendor: 'groq',
      request_id: 'r-garbage',
    });

    const res = await transcribe(audio());

    expect(res.is_garbage).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* transcribe — error taxonomy                                                */
/* -------------------------------------------------------------------------- */

describe('transcribe error taxonomy', () => {
  it('maps 413 payload_too_large and keeps the upstream request_id', async () => {
    stubFetchJson(envelope('payload_too_large', 'r-413'), { status: 413 });
    await expectUiError(transcribe(audio()), 'payload_too_large', 'r-413');
  });

  it('maps 400 invalid_audio', async () => {
    stubFetchJson(envelope('invalid_audio', 'r-400'), { status: 400 });
    await expectUiError(transcribe(audio()), 'invalid_audio', 'r-400');
  });

  it('maps 502 vendor_timeout distinctly from vendor_error', async () => {
    stubFetchJson(envelope('vendor_timeout', 'r-502a'), { status: 502 });
    await expectUiError(transcribe(audio()), 'vendor_timeout', 'r-502a');

    stubFetchJson(envelope('vendor_error', 'r-502b'), { status: 502 });
    await expectUiError(transcribe(audio()), 'vendor_error', 'r-502b');
  });

  it('maps a plain FastAPI 422 {detail:[...]} — a different shape from the envelope', async () => {
    stubFetchJson(
      {
        detail: [
          {
            type: 'missing',
            loc: ['body', 'file'],
            msg: 'Field required',
            input: null,
          },
        ],
      },
      { status: 422 },
    );

    const err = await expectUiError(transcribe(audio()), 'validation');
    // The FastAPI shape carries no request_id; inventing one would be a lie.
    expect(err.requestId).toBeUndefined();
  });

  it('falls back to vendor_error for an unrecognised error body', async () => {
    stubFetchWith(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    await expectUiError(transcribe(audio()), 'vendor_error');
  });

  it('maps a thrown fetch to proxy_unreachable', async () => {
    stubFetchRejecting(new TypeError('fetch failed'));
    await expectUiError(transcribe(audio()), 'proxy_unreachable');
  });

  it('maps an aborted request to aborted, not proxy_unreachable', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    stubFetchRejecting(abortError);
    await expectUiError(transcribe(audio()), 'aborted');
  });

  it('honours a caller-provided AbortSignal that is already aborted', async () => {
    const fetchMock = stubFetchJson({});
    const controller = new AbortController();
    controller.abort();

    await expectUiError(transcribe(audio(), { signal: controller.signal }), 'aborted');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* match                                                                      */
/* -------------------------------------------------------------------------- */

describe('match', () => {
  it('POSTs JSON to the same-origin proxy and omits an unresolved unit', async () => {
    const fetchMock = stubFetchJson({
      status: 'matched',
      candidates: [],
      top_score: 0.97,
      margin: 0.4,
      request_id: 'm-1',
    });

    await match({ spoken_name: 'lechuga batavia', catalogue_id: 'stock_restaurante_fuentes_ayb' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/match');
    expect(String(url)).not.toContain('8002');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      spoken_name: 'lechuga batavia',
      catalogue_id: 'stock_restaurante_fuentes_ayb',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards a resolved unit when extraction produced one', async () => {
    const fetchMock = stubFetchJson({
      status: 'matched',
      candidates: [],
      top_score: 0.9,
      margin: 0.3,
      request_id: 'm-2',
    });

    await match({ spoken_name: 'lechuga', catalogue_id: 'cat', unit: 'kilos' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).unit).toBe('kilos');
  });

  it('returns matched with candidate nulls intact', async () => {
    stubFetchJson({
      status: 'matched',
      candidates: [
        {
          nr_articulo: null,
          articulo: 'LECHUGA BATAVIA',
          unidad: null,
          unidad_display: null,
          score: 0.98,
        },
      ],
      top_score: 0.98,
      margin: 0.5,
      request_id: 'm-nulls',
    });

    const res = await match({ spoken_name: 'lechuga batavia', catalogue_id: 'cat' });

    expect(res.status).toBe('matched');
    const candidate = res.candidates[0]!;
    // None of these may ever be coerced to '' or a placeholder.
    expect(candidate.nr_articulo).toBeNull();
    expect(candidate.unidad).toBeNull();
    expect(candidate.unidad_display).toBeNull();
    expect(res.request_id).toBe('m-nulls');
  });

  it('returns ambiguous with its candidate list', async () => {
    stubFetchJson({
      status: 'ambiguous',
      candidates: [
        { nr_articulo: '1001', articulo: 'ACEITE DE OLIVA', unidad: 'Liter', unidad_display: 'litros', score: 0.71 },
        { nr_articulo: '1002', articulo: 'ACEITE VEGETAL', unidad: 'Liter', unidad_display: 'litros', score: 0.68 },
      ],
      top_score: 0.71,
      margin: 0.03,
      request_id: 'm-amb',
    });

    const res = await match({ spoken_name: 'aceite', catalogue_id: 'cat' });

    expect(res.status).toBe('ambiguous');
    expect(res.candidates).toHaveLength(2);
  });

  it('returns no_match as its own status', async () => {
    stubFetchJson({
      status: 'no_match',
      candidates: [],
      top_score: 0.11,
      margin: 0,
      request_id: 'm-none',
    });

    const res = await match({ spoken_name: 'tabla para picar', catalogue_id: 'cat' });

    expect(res.status).toBe('no_match');
  });

  it('maps 404 to unknown_catalogue and NEVER to a no_match result', async () => {
    stubFetchJson(envelope('unknown_catalogue', 'm-404'), { status: 404 });

    const err = await expectUiError(
      match({ spoken_name: 'lechuga', catalogue_id: 'nope' }),
      'unknown_catalogue',
      'm-404',
    );
    // Semantically different: a config bug, not "the item is not in the catalogue".
    expect(err.code).not.toBe('no_match');
  });

  it('maps 404 to unknown_catalogue even when the body is not an envelope', async () => {
    stubFetchJson({ detail: 'catalogue_id not found' }, { status: 404 });
    await expectUiError(match({ spoken_name: 'x', catalogue_id: 'nope' }), 'unknown_catalogue');
  });

  it('maps a FastAPI 422 validation error', async () => {
    stubFetchJson(
      { detail: [{ type: 'missing', loc: ['body', 'spoken_name'], msg: 'Field required' }] },
      { status: 422 },
    );
    await expectUiError(match({ spoken_name: '', catalogue_id: 'cat' }), 'validation');
  });

  it('maps a network failure to proxy_unreachable and an abort to aborted', async () => {
    stubFetchRejecting(new TypeError('Failed to fetch'));
    await expectUiError(match({ spoken_name: 'x', catalogue_id: 'cat' }), 'proxy_unreachable');

    stubFetchRejecting(new DOMException('aborted', 'AbortError'));
    await expectUiError(match({ spoken_name: 'x', catalogue_id: 'cat' }), 'aborted');
  });
});

/* -------------------------------------------------------------------------- */
/* getCatalogues                                                              */
/* -------------------------------------------------------------------------- */

describe('getCatalogues', () => {
  it('GETs the same-origin proxy and returns the catalogue list', async () => {
    const fetchMock = stubFetchJson([
      { catalogue_id: 'stock_restaurante_fuentes_ayb', rows: 107 },
      { catalogue_id: 'stock_cafeteria', rows: 42 },
    ]);

    const res = await getCatalogues();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/catalogues');
    expect(init.method ?? 'GET').toBe('GET');
    expect(res).toHaveLength(2);
    expect(res[0]!.catalogue_id).toBe('stock_restaurante_fuentes_ayb');
  });

  it('maps an unreachable proxy to proxy_unreachable', async () => {
    stubFetchRejecting(new TypeError('fetch failed'));
    await expectUiError(getCatalogues(), 'proxy_unreachable');
  });

  it('maps a 502 envelope to vendor_error with its request_id', async () => {
    stubFetchJson(envelope('vendor_error', 'c-502'), { status: 502 });
    await expectUiError(getCatalogues(), 'vendor_error', 'c-502');
  });
});

/* -------------------------------------------------------------------------- */
/* Timeout budgets (REQ-PRX-3)                                                */
/* -------------------------------------------------------------------------- */

describe('timeout budgets', () => {
  it('gives transcribe a budget that OUTLASTS the 45 s STT_TOTAL_DEADLINE_S', async () => {
    expect(TRANSCRIBE_TIMEOUT_MS).toBe(50_000);
    // The upstream deadline, not the client, must decide.
    expect(TRANSCRIBE_TIMEOUT_MS).toBeGreaterThan(45_000);
  });

  it('gives match a much shorter budget — the matcher p95 is ~1.8 ms', async () => {
    expect(MATCH_TIMEOUT_MS).toBe(10_000);
    expect(MATCH_TIMEOUT_MS).toBeLessThan(TRANSCRIBE_TIMEOUT_MS);
  });

  it('composes the caller signal with the timeout so either can abort', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    stubFetchWith(async (_input, init) => {
      seen.push(init?.signal);
      return jsonResponse({ status: 'no_match', candidates: [], top_score: 0, margin: 0, request_id: 'm' });
    });

    const controller = new AbortController();
    await match({ spoken_name: 'x', catalogue_id: 'cat' }, { signal: controller.signal });

    const signal = seen[0]!;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Structural conformance with the frozen seam types                          */
/* -------------------------------------------------------------------------- */

describe('frozen seam conformance', () => {
  it('exposes functions assignable to TranscribeFn / MatchFn / GetCataloguesFn', () => {
    // Compile-time proof that PipelineDeps (T13) can consume this client.
    const fns: {
      transcribe: import('../../src/lib/api/types').TranscribeFn;
      match: import('../../src/lib/api/types').MatchFn;
      getCatalogues: import('../../src/lib/api/types').GetCataloguesFn;
    } = { transcribe, match, getCatalogues };

    expect(typeof fns.transcribe).toBe('function');
    expect(typeof fns.match).toBe('function');
    expect(typeof fns.getCatalogues).toBe('function');
    expect(vi.isMockFunction(fns.match)).toBe(false);
  });
});

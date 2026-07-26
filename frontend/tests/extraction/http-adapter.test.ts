/**
 * `HttpExtractionAdapter` — the production extraction adapter (REQ-EXT-6).
 *
 * Two contracts are under test and they pull in opposite directions:
 *
 *  1. TOLERANCE on a 2xx body. The real service canonicalises `producto` and
 *     `unidad` through an LLM consensus, so its shape can drift. Drift must
 *     degrade to fewer items — never to a thrown error, which would burn the
 *     demo by second-guessing a genuine 200.
 *  2. STRICTNESS on transport. A non-2xx, a timeout or a dead proxy MUST throw,
 *     because throwing is exactly what arms the mock fallback (REQ-EXT-7).
 */
import { describe, expect, it } from 'vitest';

import { HttpExtractionAdapter, httpExtractionAdapter } from '../../src/lib/extraction/http';
import { UiError } from '../../src/lib/api/types';
import { jsonResponse, stubFetchJson, stubFetchRejecting, stubFetchWith } from '../setup';

const adapter = new HttpExtractionAdapter();

/** The extractor's wire item shape. */
function wireItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { producto: 'Lechuga Batavia', unidad: 'KILOGRAMO', cantidad: 3, ...over };
}

describe('REQ-EXT-6 — request shape', () => {
  it('POSTs {transcription} as JSON to the same-origin /api/extract', async () => {
    const fetchMock = stubFetchJson({ validated_inventory: [wireItem()] });

    await adapter.extract('tres kilos de lechuga batavia');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/extract');
    // Same-origin only: the extractor's own port must never appear here.
    expect(String(url)).not.toContain('8003');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      transcription: 'tres kilos de lechuga batavia',
    });
  });

  it('sends the transcript verbatim — no trimming, no normalisation', async () => {
    const fetchMock = stubFetchJson({ validated_inventory: [] });

    await adapter.extract('  DOS  CAJAS de Tomate Chonto ');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).transcription).toBe('  DOS  CAJAS de Tomate Chonto ');
  });
});

describe('REQ-EXT-6 — successful mapping', () => {
  it('maps producto/unidad/cantidad onto spokenName/unit/quantity', async () => {
    stubFetchJson({
      validated_inventory: [wireItem({ producto: 'Lechuga Batavia', unidad: 'KILOGRAMO', cantidad: 3 })],
    });

    await expect(adapter.extract('tres kilos de lechuga batavia')).resolves.toEqual([
      { quantity: 3, unit: 'kilogramo', spokenName: 'Lechuga Batavia' },
    ]);
  });

  it('preserves order and count across a multi-item consensus', async () => {
    stubFetchJson({
      validated_inventory: [
        wireItem({ producto: 'Lechuga Batavia', unidad: 'KILOGRAMO', cantidad: 3 }),
        wireItem({ producto: 'Aceite Vegetal', unidad: 'LITRO', cantidad: 12 }),
        wireItem({ producto: 'Tomate Chonto', unidad: 'UNIDAD', cantidad: 2 }),
      ],
    });

    await expect(adapter.extract('...')).resolves.toEqual([
      { quantity: 3, unit: 'kilogramo', spokenName: 'Lechuga Batavia' },
      { quantity: 12, unit: 'litro', spokenName: 'Aceite Vegetal' },
      { quantity: 2, unit: 'unidad', spokenName: 'Tomate Chonto' },
    ]);
  });

  it.each([
    ['KILOGRAMO', 'kilogramo'],
    ['UNIDAD', 'unidad'],
    ['PORCION', 'porcion'],
    ['LITRO', 'litro'],
  ])('resolves the %s enum to the lowercase emission unit %s', async (wire, expected) => {
    stubFetchJson({ validated_inventory: [wireItem({ unidad: wire })] });

    const items = await adapter.extract('x');

    expect(items).toHaveLength(1);
    expect(items[0]!.unit).toBe(expected);
  });

  it('keeps an item whose unidad is outside the vocabulary, with unit null', async () => {
    // Emitting an invented unit is forbidden (REQ-EXT-4); dropping the item
    // would lose a real count the operator dictated. Null is the honest answer,
    // and the matcher treats an unresolved unit as None rather than an error.
    stubFetchJson({ validated_inventory: [wireItem({ unidad: 'MANOJO', producto: 'Cilantro' })] });

    await expect(adapter.extract('cuatro manojos de cilantro')).resolves.toEqual([
      { quantity: 3, unit: null, spokenName: 'Cilantro' },
    ]);
  });

  it.each([[null], [undefined], ['']])('treats a missing unidad (%s) as unit null', async (unidad) => {
    stubFetchJson({ validated_inventory: [wireItem({ unidad })] });

    const items = await adapter.extract('x');

    expect(items).toHaveLength(1);
    expect(items[0]!.unit).toBeNull();
    expect(items[0]!.quantity).toBe(3);
  });

  it('keeps a decimal cantidad verbatim — rounding it would invent a count', async () => {
    stubFetchJson({ validated_inventory: [wireItem({ cantidad: 1.5 })] });

    const items = await adapter.extract('kilo y medio de lechuga');

    expect(items[0]!.quantity).toBe(1.5);
  });

  it('trims surrounding whitespace off producto', async () => {
    stubFetchJson({ validated_inventory: [wireItem({ producto: '  Tomate Chonto  ' })] });

    const items = await adapter.extract('x');

    expect(items[0]!.spokenName).toBe('Tomate Chonto');
  });
});

describe('REQ-EXT-6 — invalid items are dropped, never repaired', () => {
  it.each([
    ['zero cantidad', wireItem({ cantidad: 0 })],
    ['negative cantidad', wireItem({ cantidad: -1 })],
    ['NaN cantidad', wireItem({ cantidad: Number.NaN })],
    ['non-numeric cantidad', wireItem({ cantidad: 'tres' })],
    ['missing cantidad', { producto: 'Arroz', unidad: 'KILOGRAMO' }],
    ['blank producto', wireItem({ producto: '   ' })],
    ['missing producto', { unidad: 'KILOGRAMO', cantidad: 2 }],
    ['not an object', 'lechuga'],
  ])('drops the item with %s and keeps the valid one alongside it', async (_label, bad) => {
    stubFetchJson({
      validated_inventory: [bad, wireItem({ producto: 'Arroz Diana', unidad: 'KILOGRAMO', cantidad: 2 })],
    });

    await expect(adapter.extract('x')).resolves.toEqual([
      { quantity: 2, unit: 'kilogramo', spokenName: 'Arroz Diana' },
    ]);
  });
});

describe('REQ-EXT-6 — a 2xx body never throws', () => {
  it('yields [] for an empty validated_inventory: that is a verdict, not a failure', async () => {
    // The pipeline turns this into `nothing_extracted` («repite»). It must NOT
    // arm the fallback: the consensus genuinely found nothing to count.
    stubFetchJson({ validated_inventory: [], consensus_status: 'NO_ITEMS', confidence_score: 0.9 });

    await expect(adapter.extract('hola buenos dias')).resolves.toEqual([]);
  });

  it.each([
    ['a missing validated_inventory', { consensus_status: 'FULL_CONSENSUS' }],
    ['a non-array validated_inventory', { validated_inventory: { producto: 'x' } }],
    ['a null validated_inventory', { validated_inventory: null }],
    ['a bare array envelope', [wireItem()]],
  ])('yields [] on %s rather than throwing at the operator', async (_label, body) => {
    stubFetchJson(body);

    await expect(adapter.extract('x')).resolves.toEqual([]);
  });
});

describe('REQ-EXT-7 — transport failures throw, which is what arms the fallback', () => {
  it('rejects with UiError(vendor_error) when the proxy answers 502 proxy_unreachable', async () => {
    // `proxy_unreachable` is an envelope-only code the client does not trust
    // verbatim, so the 502 status decides: vendor_error.
    stubFetchWith(async () =>
      jsonResponse(
        { error: { code: 'proxy_unreachable', message: 'no se pudo contactar el servicio upstream' } },
        { status: 502 },
      ),
    );

    const error = await adapter.extract('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UiError);
    expect((error as UiError).code).toBe('vendor_error');
  });

  it('rejects with UiError(vendor_error) on an extractor 500 {detail} body', async () => {
    stubFetchWith(async () =>
      jsonResponse({ detail: 'Vertex AI credentials are not configured' }, { status: 500 }),
    );

    const error = await adapter.extract('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UiError);
    expect((error as UiError).code).toBe('vendor_error');
  });

  it('rejects with UiError(proxy_unreachable) when fetch itself dies', async () => {
    stubFetchRejecting(new TypeError('fetch failed'));

    const error = await adapter.extract('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UiError);
    expect((error as UiError).code).toBe('proxy_unreachable');
  });

  it('rejects with UiError(aborted) when the abort budget expires', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    stubFetchRejecting(timeout);

    const error = await adapter.extract('x').catch((e: unknown) => e);

    expect((error as UiError).code).toBe('aborted');
  });

  it('rejects with UiError(vendor_error) when a 200 body is not JSON at all', async () => {
    stubFetchWith(async () => new Response('<html>gateway</html>', { status: 200 }));

    const error = await adapter.extract('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UiError);
    expect((error as UiError).code).toBe('vendor_error');
  });
});

describe('the shared singleton', () => {
  it('is an HttpExtractionAdapter and maps the same way as a fresh instance', async () => {
    stubFetchJson({ validated_inventory: [wireItem()] });

    await expect(httpExtractionAdapter.extract('tres kilos de lechuga batavia')).resolves.toEqual([
      { quantity: 3, unit: 'kilogramo', spokenName: 'Lechuga Batavia' },
    ]);
  });
});

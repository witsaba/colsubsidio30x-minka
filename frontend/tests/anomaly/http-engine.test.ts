/**
 * `httpAnomalyEngine` — the real Module 4, replacing the fixture engine
 * (design D4, REQ-AV-1/3).
 *
 * `AnomalyEngine` was authored as a swap point ("a real anomaly service later
 * ships as HttpAnomalyEngine with zero call-site changes"). This is that swap.
 *
 * The engine consumes ONLY the blind verdict shape: it receives a type, a
 * severity and a title, and it composes the operator copy locally from a static
 * table. No figure from the catalogue statistics ever reaches the device.
 */
import { describe, expect, it } from 'vitest';

import { createHttpAnomalyEngine } from '../../src/lib/anomaly/httpEngine';
import type { ConfirmableItem } from '../../src/lib/pipeline';

function item(overrides: { quantity?: number; unit?: string | null } = {}): ConfirmableItem {
  return {
    extracted: {
      spokenName: 'aceite girasol',
      quantity: overrides.quantity ?? 90,
      unit: overrides.unit === undefined ? 'kilos' : overrides.unit,
    },
    match: { status: 'matched', candidates: [], top_score: 1, margin: 0, request_id: 'req-1' },
    picked: {
      articulo: 'ACEITE GIRASOL 900',
      nr_articulo: 'SKU-1',
      unidad: 'kg',
      unidad_display: 'kilos',
      score: 1,
    },
  } as unknown as ConfirmableItem;
}

const context = {
  planId: 'plan-1',
  warehouseId: 'wh-1',
  productIdOf: () => 'prod-1',
};

function stubFetch(response: Response | Error) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

function verdictResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createHttpAnomalyEngine', () => {
  it('posts the count facts to /api/anomaly-check', async () => {
    const fetcher = stubFetch(verdictResponse({ verdict: 'ok', anomaly: null }));
    const engine = createHttpAnomalyEngine(context, fetcher.fn);

    await engine.check(item({ quantity: 20 }));

    expect(fetcher.calls).toHaveLength(1);
    expect(fetcher.calls[0]!.url).toBe('/api/anomaly-check');
    expect(fetcher.calls[0]!.body).toEqual({
      planId: 'plan-1',
      warehouseId: 'wh-1',
      productId: 'prod-1',
      quantity: 20,
      unitCode: 'kilos',
    });
  });

  it('resolves null for a clean verdict', async () => {
    const engine = createHttpAnomalyEngine(context, stubFetch(verdictResponse({ verdict: 'ok', anomaly: null })).fn);

    await expect(engine.check(item())).resolves.toBeNull();
  });

  it('maps an atypical-quantity verdict onto the cantidad anomaly the sheet renders', async () => {
    const engine = createHttpAnomalyEngine(
      context,
      stubFetch(
        verdictResponse({
          verdict: 'warning',
          anomaly: { type: 'atypical_quantity', severity: 'warning', title: 'Cantidad fuera de lo habitual' },
        }),
      ).fn,
    );

    const anomaly = await engine.check(item());

    expect(anomaly).toEqual({
      kind: 'cantidad',
      title: 'Cantidad fuera de lo habitual',
      reason: expect.stringContaining('habitual'),
      hint: expect.stringContaining('auditor'),
    });
  });

  it('maps a unit-mismatch verdict onto the unidad anomaly', async () => {
    const engine = createHttpAnomalyEngine(
      context,
      stubFetch(
        verdictResponse({
          verdict: 'error',
          anomaly: { type: 'unit_mismatch', severity: 'error', title: 'Revisa la unidad antes de seguir' },
        }),
      ).fn,
    );

    const anomaly = await engine.check(item({ unit: 'litros' }));

    expect(anomaly?.kind).toBe('unidad');
    expect(anomaly?.title).toBe('Revisa la unidad antes de seguir');
  });

  it('carries no figures in the copy it composes (RF-18)', async () => {
    const engine = createHttpAnomalyEngine(
      context,
      stubFetch(
        verdictResponse({
          verdict: 'warning',
          anomaly: { type: 'atypical_quantity', severity: 'warning', title: 'Cantidad fuera de lo habitual' },
        }),
      ).fn,
    );

    const anomaly = await engine.check(item());

    // The PRD reference ("RF-26(c)") is the only permitted numeral: it names a
    // requirement, not a catalogue figure.
    const copy = `${anomaly?.reason} ${anomaly?.hint}`.replace(/RF-\d+\([a-z]\)/g, '');
    expect(copy).not.toMatch(/\d/);
  });

  it('degrades to null when the network fails, so the pipeline is not broken', async () => {
    const engine = createHttpAnomalyEngine(context, stubFetch(new TypeError('offline')).fn);

    await expect(engine.check(item())).resolves.toBeNull();
  });

  it('degrades to null on a non-2xx response', async () => {
    const engine = createHttpAnomalyEngine(context, stubFetch(new Response('boom', { status: 500 })).fn);

    await expect(engine.check(item())).resolves.toBeNull();
  });

  it('never calls the service when the item has no resolvable catalogue product', async () => {
    const fetcher = stubFetch(verdictResponse({ verdict: 'ok', anomaly: null }));
    const engine = createHttpAnomalyEngine({ ...context, productIdOf: () => null }, fetcher.fn);

    await expect(engine.check(item())).resolves.toBeNull();
    expect(fetcher.calls).toEqual([]);
  });
});

/**
 * `POST /api/anomaly-check` (REQ-AV-3, design D3/D4).
 *
 * The route is the operator-facing edge of the validation module, so it is
 * where RF-18 is actually observable: whatever this handler writes to the wire
 * is what a curious operator sees in the network tab.
 */
import { describe, expect, it } from 'vitest';

import { handleAnomalyCheck, prerender } from '../../src/pages/api/anomaly-check';
import { createStubDb } from '../server/stub-db';

function request(body: unknown): Request {
  return new Request('http://localhost:4321/api/anomaly-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function catalogueDb() {
  return createStubDb({
    tables: {
      product_count_ranges: [
        {
          product_id: 'prod-1',
          warehouse_id: 'wh-1',
          expected_min: 10,
          expected_max: 30,
          expected_unit_code: 'KG',
        },
      ],
      warehouse_stock_balances: [{ product_id: 'prod-1', warehouse_id: 'wh-1', theoretical_qty: 500 }],
    },
  });
}

const validBody = {
  planId: 'plan-1',
  warehouseId: 'wh-1',
  productId: 'prod-1',
  quantity: 90,
  unitCode: 'KG',
};

describe('POST /api/anomaly-check', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('answers an out-of-range count with a warning verdict', async () => {
    const response = await handleAnomalyCheck(catalogueDb(), request(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      verdict: 'warning',
      anomaly: { type: 'atypical_quantity', severity: 'warning', title: expect.any(String) },
    });
  });

  it('answers an in-range count with a clean verdict', async () => {
    const response = await handleAnomalyCheck(
      catalogueDb(),
      request({ ...validBody, quantity: 20 }),
    );

    await expect(response.json()).resolves.toEqual({ verdict: 'ok', anomaly: null });
  });

  it('never puts a range bound or a theoretical quantity on the wire (RF-18)', async () => {
    const response = await handleAnomalyCheck(catalogueDb(), request(validBody));

    const body = await response.text();

    for (const leak of ['expected_min', 'expected_max', 'theoretical', 'sd', '"30"', '500']) {
      expect(body).not.toContain(leak);
    }
  });

  it('rejects a body with no quantity as a 400 without touching the database', async () => {
    const db = catalogueDb();

    const response = await handleAnomalyCheck(db, request({ ...validBody, quantity: undefined }));

    expect(response.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it('rejects a non-JSON body as a 400', async () => {
    const bad = new Request('http://localhost:4321/api/anomaly-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect((await handleAnomalyCheck(catalogueDb(), bad)).status).toBe(400);
  });
});

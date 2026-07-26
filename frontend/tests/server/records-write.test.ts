/**
 * `POST /api/records` (REQ-SDA-4, REQ-SDA-5, REQ-AV-2; design D2/D4/D5).
 *
 * Three properties are load-bearing here and each has its own guard:
 *
 *  1. RF-07 — an operator writing against a plan they are not assigned to is
 *     refused with 403 and ZERO writes. The refusal must precede the insert,
 *     not follow it.
 *  2. Idempotency — the client mints the record id, so a retried POST after a
 *     flaky connection must not double-count the shelf.
 *  3. REQ-AV-2 — `record_anomalies` is written from the SERVER's own
 *     re-validation. The client's verdict is advisory and is never trusted:
 *     the anomaly the auditor reviews has to be one the server computed.
 */
import { describe, expect, it } from 'vitest';

import { COUNT_STATUS, handleCreateRecord, prerender } from '../../src/pages/api/records/index';
import { createStubDb } from './stub-db';

const body = {
  clientRecordId: 'client-uuid-1',
  planId: 'plan-1',
  operatorId: 'op-1',
  productId: 'prod-1',
  quantity: 20,
  unitCode: 'KG',
  articulo: 'ACEITE GIRASOL 900',
  nrArticulo: 'SKU-1',
  spokenName: 'aceite girasol',
};

function request(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://localhost:4321/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, ...overrides }),
  });
}

function db(options: { assigned?: boolean; errors?: Record<string, string> } = {}) {
  const { assigned = true } = options;
  return createStubDb({
    errors: options.errors,
    tables: {
      audit_plans: [{ id: 'plan-1', status: 'active', warehouse_id: 'wh-1', catalogue_id: 'cat-1' }],
      plan_operators: assigned ? [{ plan_id: 'plan-1', profile_id: 'op-1' }] : [],
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

describe('POST /api/records — RF-07 authorization', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('refuses an unassigned operator with 403 and writes nothing', async () => {
    const stub = db({ assigned: false });

    const response = await handleCreateRecord(stub, request());

    expect(response.status).toBe(403);
    expect(stub.rows('count_records')).toEqual([]);
    expect(stub.callsOf('insert')).toEqual([]);
  });

  it('refuses before reading count_records at all', async () => {
    const stub = db({ assigned: false });

    await handleCreateRecord(stub, request());

    expect(stub.calls.map((call) => call.table)).not.toContain('count_records');
  });
});

describe('POST /api/records — persistence', () => {
  it('inserts the count with the plan warehouse and the voice source', async () => {
    const stub = db();

    const response = await handleCreateRecord(stub, request());

    expect(response.status).toBe(201);
    expect(stub.rows('count_records')[0]).toMatchObject({
      plan_id: 'plan-1',
      warehouse_id: 'wh-1',
      product_id: 'prod-1',
      quantity: 20,
      unit_code: 'KG',
      source: 'voice',
      status: COUNT_STATUS.ok,
      dictated_text: 'aceite girasol',
      counted_by: 'op-1',
      client_record_id: 'client-uuid-1',
      is_deleted: false,
    });
  });

  it('answers with the server id and the server verdict', async () => {
    const stub = db();

    const created = (await (await handleCreateRecord(stub, request())).json()) as {
      id: string;
      verdict: string;
      anomaly: unknown;
    };

    expect(created.id).toBe(stub.rows('count_records')[0]!.id);
    expect(created.verdict).toBe('ok');
    expect(created.anomaly).toBeNull();
  });

  it('resolves a repeated clientRecordId to the existing row instead of inserting twice', async () => {
    const stub = db();

    const first = await handleCreateRecord(stub, request());
    const retry = await handleCreateRecord(stub, request());

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(stub.rows('count_records')).toHaveLength(1);
    const firstId = ((await first.json()) as { id: string }).id;
    expect(((await retry.json()) as { id: string }).id).toBe(firstId);
  });

  it('answers 5xx and returns no id when the insert fails', async () => {
    const stub = db({ errors: { 'insert:count_records': 'permission denied' } });

    const response = await handleCreateRecord(stub, request());

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(stub.rows('count_records')).toEqual([]);
  });

  it('rejects a body with no quantity as 400 without authorizing or writing', async () => {
    const stub = db();

    const response = await handleCreateRecord(stub, request({ quantity: undefined }));

    expect(response.status).toBe(400);
    expect(stub.calls).toEqual([]);
  });
});

describe('POST /api/records — server re-validation (REQ-AV-2, RF-18)', () => {
  it('writes record_anomalies from its OWN verdict, ignoring the client claim', async () => {
    const stub = db();

    // The client claims everything is fine; the quantity is in fact out of range.
    await handleCreateRecord(stub, request({ quantity: 90, verdict: 'ok', anomaly: null }));

    expect(stub.rows('record_anomalies')).toHaveLength(1);
    expect(stub.rows('record_anomalies')[0]).toMatchObject({
      record_id: stub.rows('count_records')[0]!.id,
      type: 'atypical_quantity',
      severity: 'warning',
      expected_unit_code: 'KG',
    });
  });

  it('flags the stored record so the auditor dashboard can filter it', async () => {
    const stub = db();

    await handleCreateRecord(stub, request({ quantity: 90 }));

    expect(stub.rows('count_records')[0]!.status).toBe(COUNT_STATUS.anomaly);
  });

  it('writes no anomaly row for a clean count', async () => {
    const stub = db();

    await handleCreateRecord(stub, request({ quantity: 20 }));

    expect(stub.rows('record_anomalies')).toEqual([]);
  });

  it('never returns a range bound or theoretical quantity to the operator (RF-18)', async () => {
    const stub = db();

    const response = await handleCreateRecord(stub, request({ quantity: 90 }));

    const text = await response.text();
    for (const leak of ['expected_min', 'expectedMin', 'theoretical', 'detail', '500']) {
      expect(text).not.toContain(leak);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Product identity — the matcher speaks nr_articulo, the database speaks uuid */
/* -------------------------------------------------------------------------- */

/**
 * The browser never sees `products.id`. The matcher answers with catalogue rows
 * keyed by `nr_articulo`, so the resolution to a Supabase product uuid has to
 * happen HERE — the client has no product table to look in, and giving it one
 * would mean shipping the catalogue to the device.
 *
 * The resolution is loud on failure by design: an unresolvable article must not
 * silently become a count against nothing.
 */
describe('POST /api/records — resolves nrArticulo to a product uuid', () => {
  function catalogueDb(options: { assigned?: boolean } = {}) {
    const stub = db(options);
    stub.rows('products').push(
      { id: 'prod-1', sku: 'SKU-1', name_normalized: 'ACEITE GIRASOL 900' },
      { id: 'prod-2', sku: 'SKU-2', name_normalized: 'LECHUGA BATAVIA' },
    );
    return stub;
  }

  it('writes the resolved product uuid when the body carries only nrArticulo', async () => {
    const stub = catalogueDb();

    const response = await handleCreateRecord(
      stub,
      request({ productId: undefined, nrArticulo: 'SKU-1' }),
    );

    expect(response.status).toBe(201);
    expect(stub.rows('count_records')[0]!.product_id).toBe('prod-1');
  });

  it('resolves a DIFFERENT article to its own uuid', async () => {
    const stub = catalogueDb();

    await handleCreateRecord(stub, request({ productId: undefined, nrArticulo: 'SKU-2' }));

    expect(stub.rows('count_records')[0]!.product_id).toBe('prod-2');
  });

  it('refuses with 400 and writes nothing when the article resolves to no product', async () => {
    const stub = catalogueDb();

    const response = await handleCreateRecord(
      stub,
      request({ productId: undefined, nrArticulo: 'SKU-UNKNOWN', articulo: 'NO EXISTE' }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('No encontramos ese artículo en el catálogo.');
    expect(stub.rows('count_records')).toEqual([]);
  });

  it('prefers an explicit productId and never looks the article up', async () => {
    const stub = catalogueDb();

    await handleCreateRecord(stub, request({ productId: 'prod-2', nrArticulo: 'SKU-1' }));

    expect(stub.rows('count_records')[0]!.product_id).toBe('prod-2');
    expect(stub.calls.filter((call) => call.table === 'products')).toEqual([]);
  });

  it('still authorizes first: an unassigned operator is refused before any lookup', async () => {
    const stub = catalogueDb({ assigned: false });

    const response = await handleCreateRecord(
      stub,
      request({ productId: undefined, nrArticulo: 'SKU-1' }),
    );

    expect(response.status).toBe(403);
    expect(stub.calls.filter((call) => call.table === 'products')).toEqual([]);
  });

  /**
   * Task 6.10. `products.sku` is NULL for ~18.4% of the real catalogue, so a
   * sku-only route makes roughly one article in five impossible to count. The
   * route must forward the matcher's catalogue name so the resolver can fall
   * back to `name_normalized`.
   */
  it('counts a sku-less article by forwarding the catalogue name to the resolver', async () => {
    const stub = catalogueDb();
    stub.rows('products').push({ id: 'prod-3', sku: null, name_normalized: 'AGUA WAIRA' });

    const response = await handleCreateRecord(
      stub,
      request({ productId: undefined, nrArticulo: null, articulo: 'Agua Waira' }),
    );

    expect(response.status).toBe(201);
    expect(stub.rows('count_records')[0]!.product_id).toBe('prod-3');
  });

  it('still 400s when neither the code nor the name is in the catalogue', async () => {
    const stub = catalogueDb();

    const response = await handleCreateRecord(
      stub,
      request({ productId: undefined, nrArticulo: 'SKU-UNKNOWN', articulo: 'NO EXISTE' }),
    );

    expect(response.status).toBe(400);
    expect(stub.rows('count_records')).toEqual([]);
  });
});

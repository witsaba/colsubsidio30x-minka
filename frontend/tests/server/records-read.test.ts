/**
 * `GET /api/records?planId=&operatorId=` — session resume (REQ-OCF-13, task 6.11).
 *
 * Why this route has to exist: `CountRecord.id` is CLIENT-minted
 * (`rec-${at}-${seq}`, `reducer.ts`) and is sent as the unique
 * `count_records.client_record_id`. Reloading `/conteo` mid-count therefore
 * mints a fresh series, so re-dictating the same shelf writes a SECOND row for
 * the same physical count — double-counted inventory, the exact failure class
 * this feature exists to prevent. The operator has to get their own records back.
 *
 * Three properties are load-bearing:
 *
 *  1. RF-07 — the plan-scope check comes FIRST, exactly as on the write path.
 *     A read is not a lesser right: the list is what was counted in a plan.
 *  2. RF-21 — soft-deleted rows never come back. They were corrected; restoring
 *     them would present a shelf as counted twice on the operator's own screen.
 *  3. RF-18 — this is an OPERATOR route, so the payload stays blind. No
 *     theoretical stock, no expected range, no anomaly detail; only the same
 *     `{type, severity, title}` triple the write path already allows through.
 */
import { describe, expect, it } from 'vitest';

import { handleListRecords, prerender } from '../../src/pages/api/records/index';
import { createStubDb } from './stub-db';

function request(query = 'planId=plan-1&operatorId=op-1'): Request {
  return new Request(`http://localhost:4321/api/records?${query}`, { method: 'GET' });
}

function db(options: { assigned?: boolean } = {}) {
  const { assigned = true } = options;
  return createStubDb({
    tables: {
      audit_plans: [{ id: 'plan-1', status: 'active', warehouse_id: 'wh-1' }],
      warehouses: [{ id: 'wh-1', code: 'STOCK_RESTAURANTE_FUENTES_AYB' }],
      plan_operators: assigned ? [{ plan_id: 'plan-1', profile_id: 'op-1' }] : [],
      units: [
        { code: 'KG', label_es: 'Kilogramo' },
        { code: 'UND', label_es: 'Unidad' },
      ],
      products: [
        { id: 'prod-1', sku: 'SKU-1', name: 'ACEITE GIRASOL 900' },
        { id: 'prod-2', sku: null, name: 'AGUA WAIRA' },
      ],
      count_records: [
        {
          id: 'srv-1',
          plan_id: 'plan-1',
          warehouse_id: 'wh-1',
          product_id: 'prod-1',
          counted_by: 'op-1',
          client_record_id: 'rec-1000-0',
          quantity: 20,
          unit_code: 'KG',
          status: 'recorded',
          dictated_text: 'veinte kilos de aceite',
          created_at: '2026-07-25T13:00:00Z',
          is_deleted: false,
        },
        {
          id: 'srv-2',
          plan_id: 'plan-1',
          warehouse_id: 'wh-1',
          product_id: 'prod-2',
          counted_by: 'op-1',
          client_record_id: 'rec-1000-1',
          quantity: 7,
          unit_code: 'UND',
          status: 'flagged',
          dictated_text: 'siete aguas',
          created_at: '2026-07-25T13:05:00Z',
          is_deleted: false,
        },
      ],
      record_anomalies: [
        {
          record_id: 'srv-2',
          type: 'atypical_quantity',
          severity: 'warning',
          title: 'Cantidad fuera de lo habitual',
          detail: 'expected 20-40, got 7',
          expected_unit_code: 'UND',
          status: 'open',
        },
      ],
    },
  });
}

describe('GET /api/records — RF-07 authorization comes first', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('refuses an unassigned operator with 403 and no records', async () => {
    const stub = db({ assigned: false });

    const response = await handleListRecords(stub, request());

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('srv-1');
  });

  it('refuses before reading count_records at all', async () => {
    const stub = db({ assigned: false });

    await handleListRecords(stub, request());

    expect(stub.calls.map((call) => call.table)).not.toContain('count_records');
  });

  it('rejects a request with no planId as 400 without touching the database', async () => {
    const stub = db();

    const response = await handleListRecords(stub, request('operatorId=op-1'));

    expect(response.status).toBe(400);
    expect(stub.calls).toEqual([]);
  });
});

describe('GET /api/records — restores the operator session', () => {
  async function payload(stub = db(), query?: string) {
    const response = await handleListRecords(stub, request(query));
    return (await response.json()) as Array<Record<string, unknown>>;
  }

  it('returns the plan records newest first, the order the list renders in', async () => {
    const records = await payload();

    expect(records.map((r) => r.serverId)).toEqual(['srv-2', 'srv-1']);
  });

  it('carries the CLIENT record id back, so a resumed session keeps its keys', async () => {
    const records = await payload();

    // The whole point: without this the resumed session mints a new
    // `client_record_id` for a shelf that already has one.
    expect(records.map((r) => r.id)).toEqual(['rec-1000-1', 'rec-1000-0']);
  });

  it('renders the article name and code from products, not the raw uuid', async () => {
    const records = await payload();

    expect(records[1]).toMatchObject({
      quantity: 20,
      articulo: 'ACEITE GIRASOL 900',
      nrArticulo: 'SKU-1',
      spokenName: 'veinte kilos de aceite',
      unitCode: 'KG',
      unitDisplay: 'Kilogramo',
    });
  });

  it('leaves nrArticulo null for a sku-less product instead of inventing a code', async () => {
    const records = await payload();

    expect(records[0]!.nrArticulo).toBeNull();
    expect(records[0]!.articulo).toBe('AGUA WAIRA');
  });

  it('maps a confirmed row to ok and a flagged row to anom_noted', async () => {
    const records = await payload();

    expect(records.map((r) => r.state)).toEqual(['anom_noted', 'ok']);
  });

  it('carries the anomaly title so the resumed list shows the same badge', async () => {
    const records = await payload();

    expect(records[0]!.anomaly).toMatchObject({
      type: 'atypical_quantity',
      severity: 'warning',
      title: 'Cantidad fuera de lo habitual',
    });
  });

  it('excludes soft-deleted rows (RF-21)', async () => {
    const stub = db();
    stub.rows('count_records').push({
      id: 'srv-3',
      plan_id: 'plan-1',
      warehouse_id: 'wh-1',
      product_id: 'prod-1',
      counted_by: 'op-1',
      client_record_id: 'rec-1000-2',
      quantity: 99,
      unit_code: 'KG',
      status: 'recorded',
      created_at: '2026-07-25T13:10:00Z',
      is_deleted: true,
    });

    const records = await payload(stub);

    expect(records.map((r) => r.serverId)).toEqual(['srv-2', 'srv-1']);
  });

  it('returns only what THIS operator counted, not the whole plan', async () => {
    const stub = db();
    stub.rows('count_records').push({
      id: 'srv-4',
      plan_id: 'plan-1',
      warehouse_id: 'wh-1',
      product_id: 'prod-1',
      counted_by: 'op-2',
      client_record_id: 'rec-2000-0',
      quantity: 5,
      unit_code: 'KG',
      status: 'recorded',
      created_at: '2026-07-25T13:20:00Z',
      is_deleted: false,
    });

    const records = await payload(stub);

    expect(records.map((r) => r.serverId)).toEqual(['srv-2', 'srv-1']);
  });

  it('answers an empty list for a plan the operator has not counted yet', async () => {
    const stub = db();
    stub.rows('count_records').length = 0;

    const records = await payload(stub);

    expect(records).toEqual([]);
  });
});

describe('GET /api/records — the payload stays blind (RF-18)', () => {
  it('never carries a range bound, a theoretical stock or an anomaly detail', async () => {
    const stub = db();
    // The facts exist and are reachable from this plan — a pass must come from
    // the projection refusing them, not from the data being absent.
    stub.rows('product_count_ranges').push({
      product_id: 'prod-2',
      warehouse_id: 'wh-1',
      expected_min: 20,
      expected_max: 40,
    });
    stub.rows('warehouse_stock_balances').push({
      product_id: 'prod-2',
      warehouse_id: 'wh-1',
      theoretical_qty: 500,
    });
    expect(stub.rows('record_anomalies')[0]!.detail).toBe('expected 20-40, got 7');

    const text = await (await handleListRecords(stub, request())).text();

    for (const leak of [
      'expected_min',
      'expectedMin',
      'expected_max',
      'theoretical',
      'systemQty',
      'detail',
      '500',
      '40',
    ]) {
      expect(text).not.toContain(leak);
    }
  });
});

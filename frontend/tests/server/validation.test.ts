/**
 * Server-side anomaly validation (REQ-AV-1, REQ-AV-3, RF-25/26/27, design D3).
 *
 * This module is the ONLY place that reads `product_count_ranges` and
 * `warehouse_stock_balances`, and it is therefore the only place that can leak
 * a theoretical quantity to a counting operator. Blind counting (RF-18) is
 * enforced HERE, at the serialization boundary — not in the renderer — so no
 * future UI change can undo it.
 */
import { describe, expect, it } from 'vitest';

import {
  toOperatorVerdict,
  validateCount,
  type CountFacts,
} from '../../src/lib/server/validation';
import { createStubDb } from './stub-db';

const PLAN = 'plan-1';
const WAREHOUSE = 'wh-1';
const PRODUCT = 'prod-1';

function facts(overrides: Partial<CountFacts> = {}): CountFacts {
  return {
    planId: PLAN,
    warehouseId: WAREHOUSE,
    productId: PRODUCT,
    quantity: 20,
    unitCode: 'KG',
    ...overrides,
  };
}

/**
 * A catalogue where the product is counted in KG, 10–30 is normal, 500 in stock.
 *
 * The `product_count_ranges` fixture mirrors the LIVE table: the unit column is
 * `unit_code`, NOT `expected_unit_code`. Naming it wrong makes PostgREST error
 * the whole select, which (the error being discarded) silently disables both
 * `unit_mismatch` and `atypical_quantity` detection in production.
 */
function catalogueDb(overrides: { range?: Record<string, unknown>; balance?: Record<string, unknown> } = {}) {
  return createStubDb({
    tables: {
      product_count_ranges: [
        {
          product_id: PRODUCT,
          warehouse_id: WAREHOUSE,
          expected_min: 10,
          expected_max: 30,
          unit_code: 'KG',
          ...overrides.range,
        },
      ],
      warehouse_stock_balances: [
        {
          product_id: PRODUCT,
          warehouse_id: WAREHOUSE,
          theoretical_qty: 500,
          ...overrides.balance,
        },
      ],
    },
  });
}

describe('validateCount', () => {
  it('returns a clean verdict for an in-range quantity in the expected unit', async () => {
    const verdict = await validateCount(catalogueDb(), facts({ quantity: 20 }));

    expect(verdict).toEqual({ verdict: 'ok', anomaly: null });
  });

  it('flags a quantity above the learned maximum as an atypical-quantity warning', async () => {
    const verdict = await validateCount(catalogueDb(), facts({ quantity: 90 }));

    expect(verdict.verdict).toBe('warning');
    expect(verdict.anomaly).toMatchObject({ type: 'atypical_quantity', severity: 'warning' });
    // The bounds ARE available internally — they are written to `record_anomalies`.
    expect(verdict.anomaly?.expectedMax).toBe(30);
  });

  it('flags a quantity below the learned minimum as well (both range edges)', async () => {
    const verdict = await validateCount(catalogueDb(), facts({ quantity: 2 }));

    expect(verdict.anomaly?.type).toBe('atypical_quantity');
    expect(verdict.anomaly?.expectedMin).toBe(10);
  });

  it('flags a unit that disagrees with the catalogue as an error, ahead of the range check', async () => {
    // 90 L is BOTH out of range and in the wrong unit: the unit wins, because a
    // wrong unit makes the quantity meaningless (same precedence as the fixture engine).
    const verdict = await validateCount(catalogueDb(), facts({ quantity: 90, unitCode: 'L' }));

    expect(verdict.verdict).toBe('error');
    expect(verdict.anomaly).toMatchObject({
      type: 'unit_mismatch',
      severity: 'error',
      expectedUnitCode: 'KG',
    });
  });

  it('does not flag a unit mismatch when the dictation carried no unit at all', async () => {
    const verdict = await validateCount(catalogueDb(), facts({ quantity: 20, unitCode: null }));

    expect(verdict).toEqual({ verdict: 'ok', anomaly: null });
  });

  it('flags a count that exceeds the theoretical balance as negative_balance', async () => {
    const db = catalogueDb({
      range: { expected_min: 0, expected_max: 100_000 },
      balance: { theoretical_qty: 40 },
    });

    const verdict = await validateCount(db, facts({ quantity: 90 }));

    expect(verdict.anomaly?.type).toBe('negative_balance');
    expect(verdict.anomaly?.theoreticalQty).toBe(40);
  });

  it('returns a clean verdict when the product has no learned range and no balance', async () => {
    const db = createStubDb({ tables: { product_count_ranges: [], warehouse_stock_balances: [] } });

    const verdict = await validateCount(db, facts({ quantity: 999 }));

    expect(verdict).toEqual({ verdict: 'ok', anomaly: null });
  });

  it('never names expected_unit_code in the ranges select — the live column is unit_code', async () => {
    const db = catalogueDb();

    await validateCount(db, facts({ quantity: 20 }));

    const ranges = db.calls.find((call) => call.table === 'product_count_ranges');
    expect(ranges?.columns).toEqual(['expected_min', 'expected_max', 'unit_code']);
  });

  it('reads the expected unit from unit_code, so a mismatch is still detected', async () => {
    const verdict = await validateCount(
      catalogueDb({ range: { unit_code: 'UND' } }),
      facts({ quantity: 20, unitCode: 'KG' }),
    );

    expect(verdict.verdict).toBe('error');
    expect(verdict.anomaly).toMatchObject({ type: 'unit_mismatch', expectedUnitCode: 'UND' });
  });

  it('never reads anomaly_evidence, which is auditor-only material', async () => {
    const db = catalogueDb();

    await validateCount(db, facts({ quantity: 90 }));

    expect(db.calls.map((call) => call.table)).not.toContain('anomaly_evidence');
  });
});

describe('toOperatorVerdict — RF-18 blind counting', () => {
  /** Every key that would let an operator derive the system quantity. */
  const FORBIDDEN = [
    'theoreticalQty',
    'theoretical_qty',
    'systemQty',
    'system_qty',
    'expectedMin',
    'expected_min',
    'expectedMax',
    'expected_max',
    'sd',
    'warehouse_stock_balances',
    'detail',
  ];

  it('serializes only the allowlisted verdict shape', async () => {
    const internal = await validateCount(catalogueDb(), facts({ quantity: 90 }));

    const payload = toOperatorVerdict(internal);

    expect(payload).toEqual({
      verdict: 'warning',
      anomaly: { type: 'atypical_quantity', severity: 'warning', title: expect.any(String) },
    });
  });

  it('strips every derivable system quantity from the serialized payload', async () => {
    // The stub deliberately supplies real bounds and a real theoretical balance,
    // so a leak would be visible rather than accidentally absent.
    const internal = await validateCount(catalogueDb(), facts({ quantity: 90 }));
    expect(internal.anomaly?.expectedMax).toBe(30);

    const serialized = JSON.stringify(toOperatorVerdict(internal));

    for (const key of FORBIDDEN) {
      expect(serialized).not.toContain(key);
    }
    expect(serialized).not.toContain('30');
    expect(serialized).not.toContain('500');
  });

  it('carries no numbers in the operator-facing title', async () => {
    const internal = await validateCount(
      catalogueDb({ range: { expected_min: 0, expected_max: 100_000 }, balance: { theoretical_qty: 40 } }),
      facts({ quantity: 90 }),
    );

    const payload = toOperatorVerdict(internal);

    expect(payload.anomaly?.type).toBe('negative_balance');
    expect(payload.anomaly?.title).not.toMatch(/\d/);
  });

  it('passes a clean verdict through as a null anomaly', () => {
    expect(toOperatorVerdict({ verdict: 'ok', anomaly: null })).toEqual({
      verdict: 'ok',
      anomaly: null,
    });
  });
});

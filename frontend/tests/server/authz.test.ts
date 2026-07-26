/**
 * Route-level plan scoping (RF-07, REQ-SDA-5, design D2).
 *
 * There is no Supabase Auth session in this system, so `auth.uid()` is never
 * populated and the authored RLS policies cannot decide anything. Authorization
 * is therefore enforced HERE, in route logic, and RLS stays enabled as defence
 * in depth only. That makes this module the single point where "this operator
 * may write against this plan" is decided — and the single point that can fail
 * open, which is why the ordering assertion below exists.
 */
import { describe, expect, it } from 'vitest';

import { assertPlanAssignment } from '../../src/lib/server/authz';
import { createStubDb } from './stub-db';

const PLAN = 'plan-1';
const OPERATOR = 'op-1';
/** The live matcher catalogue vocabulary IS `warehouses.code` (change `redis-catalogue-cache`). */
const CATALOGUE = 'STOCK_RESTAURANTE_FUENTES_AYB';

/**
 * Fixtures mirror the LIVE tables, verified against the running project:
 * `audit_plans` has NO `catalogue_id` column, and the catalogue id lives on
 * `warehouses.code`. Inventing a column here would hide the exact production
 * failure this suite exists to catch — PostgREST errors the entire select on an
 * unknown column, so a single wrong name refuses every plan unconditionally.
 */
function db(options: { assigned?: boolean; status?: string; warehouses?: boolean } = {}) {
  const { assigned = true, status = 'active', warehouses = true } = options;
  return createStubDb({
    tables: {
      audit_plans: [{ id: PLAN, status, warehouse_id: 'wh-1' }],
      warehouses: warehouses ? [{ id: 'wh-1', code: CATALOGUE }] : [],
      plan_operators: assigned ? [{ plan_id: PLAN, profile_id: OPERATOR }] : [],
      count_records: [{ id: 'rec-1', plan_id: PLAN }],
    },
  });
}

describe('assertPlanAssignment', () => {
  it('grants an assigned operator on an active plan, returning the plan scope', async () => {
    const result = await assertPlanAssignment(db(), PLAN, OPERATOR);

    expect(result).toEqual({ ok: true, plan: { id: PLAN, warehouseId: 'wh-1', catalogueId: CATALOGUE } });
  });

  it('resolves the catalogue id from warehouses.code, not from a column audit_plans does not have', async () => {
    const stub = db();

    const result = await assertPlanAssignment(stub, PLAN, OPERATOR);

    expect(result).toMatchObject({ ok: true, plan: { catalogueId: CATALOGUE } });
    const warehouse = stub.calls.find((call) => call.table === 'warehouses');
    expect(warehouse?.filters).toEqual([{ column: 'id', value: 'wh-1' }]);
  });

  it('never names catalogue_id in the audit_plans select — the live table has no such column', async () => {
    const stub = db();

    await assertPlanAssignment(stub, PLAN, OPERATOR);

    const plan = stub.calls.find((call) => call.table === 'audit_plans');
    expect(plan?.columns).toEqual(['id', 'status', 'warehouse_id']);
  });

  it('still grants the plan with a null catalogue when the warehouse has no code row', async () => {
    const result = await assertPlanAssignment(db({ warehouses: false }), PLAN, OPERATOR);

    expect(result).toEqual({ ok: true, plan: { id: PLAN, warehouseId: 'wh-1', catalogueId: null } });
  });

  it('refuses an operator with no plan_operators row', async () => {
    const result = await assertPlanAssignment(db({ assigned: false }), PLAN, OPERATOR);

    expect(result.ok).toBe(false);
  });

  it('refuses a different operator than the one assigned', async () => {
    const result = await assertPlanAssignment(db(), PLAN, 'someone-else');

    expect(result.ok).toBe(false);
  });

  it('refuses an assigned operator when the plan is no longer active', async () => {
    const result = await assertPlanAssignment(db({ status: 'closed' }), PLAN, OPERATOR);

    expect(result.ok).toBe(false);
  });

  it('refuses a plan that does not exist', async () => {
    const result = await assertPlanAssignment(db(), 'ghost-plan', OPERATOR);

    expect(result.ok).toBe(false);
  });

  it('never touches count_records while deciding — the refusal precedes any data access', async () => {
    const stub = db({ assigned: false });

    await assertPlanAssignment(stub, PLAN, OPERATOR);

    expect(stub.calls.map((call) => call.table)).not.toContain('count_records');
  });

  it('queries plan_operators by BOTH plan and profile, never by plan alone', async () => {
    const stub = db();

    await assertPlanAssignment(stub, PLAN, OPERATOR);

    const assignment = stub.calls.find((call) => call.table === 'plan_operators');
    expect(assignment?.filters.map((f) => f.column).sort()).toEqual(['plan_id', 'profile_id']);
  });
});

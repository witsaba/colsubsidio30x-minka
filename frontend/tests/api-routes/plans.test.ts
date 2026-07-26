/**
 * `GET /api/plans?operator=` (REQ-SDA-3 / REQ-OCF-8, RF-11).
 *
 * The screen this feeds used to list the eight matcher catalogues directly —
 * warehouse selection, not plan selection, which the PRD's own §6.1 callout
 * flags as the wrong flow. The route therefore must NEVER be able to answer
 * with a raw plan listing: an operator with no assignments gets `[]`, not
 * "everything".
 *
 * Fixtures mirror the LIVE tables: `audit_plans` has NO `catalogue_id` column
 * (same fact as `authz.test.ts` — PostgREST errors the whole select on an
 * unknown column, silently). The catalogue id lives on `warehouses.code`
 * (change `redis-catalogue-cache`) and is resolved by a second lookup.
 */
import { describe, expect, it } from 'vitest';

import { handlePlans, prerender } from '../../src/pages/api/plans';
import { createStubDb } from '../server/stub-db';

function request(query: string): Request {
  return new Request(`http://localhost:4321/api/plans${query}`);
}

function db(options: { errors?: Record<string, string> } = {}) {
  return createStubDb({
    errors: options.errors,
    tables: {
      audit_plans: [
        { id: 'plan-1', status: 'active', name: 'Bodega A y B', warehouse_id: 'wh-1' },
        { id: 'plan-2', status: 'active', name: 'Bodega C', warehouse_id: 'wh-2' },
        { id: 'plan-3', status: 'closed', name: 'Cerrado', warehouse_id: 'wh-3' },
      ],
      warehouses: [
        { id: 'wh-1', code: 'STOCK_RESTAURANTE_FUENTES_AYB' },
        { id: 'wh-2', code: 'STOCK_ALMACEN_SUMINISTROS' },
        { id: 'wh-3', code: 'ZOOLOGICO' },
      ],
      plan_operators: [
        { plan_id: 'plan-1', profile_id: 'op-1' },
        { plan_id: 'plan-3', profile_id: 'op-1' },
        { plan_id: 'plan-2', profile_id: 'op-2' },
      ],
    },
  });
}

async function plansFor(operator: string) {
  const response = await handlePlans(db(), request(`?operator=${operator}`));
  return (await response.json()) as Array<{ id: string; name: string }>;
}

describe('GET /api/plans', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('returns only the active plans the operator is assigned to', async () => {
    const plans = await plansFor('op-1');

    expect(plans).toEqual([
      {
        id: 'plan-1',
        name: 'Bodega A y B',
        warehouseId: 'wh-1',
        catalogueId: 'STOCK_RESTAURANTE_FUENTES_AYB',
      },
    ]);
  });

  it('never names catalogue_id in the audit_plans select — the live table has no such column', async () => {
    const stub = db();

    await handlePlans(stub, request('?operator=op-1'));

    const plan = stub.calls.find((call) => call.table === 'audit_plans');
    expect(plan?.columns).toEqual(['id', 'name', 'status', 'warehouse_id']);
  });

  it('still returns the plan with a null catalogue when the warehouse has no code row', async () => {
    const stub = createStubDb({
      tables: {
        audit_plans: [{ id: 'plan-1', status: 'active', name: 'Sin bodega', warehouse_id: 'wh-x' }],
        warehouses: [],
        plan_operators: [{ plan_id: 'plan-1', profile_id: 'op-1' }],
      },
    });

    const response = await handlePlans(stub, request('?operator=op-1'));
    const plans = (await response.json()) as Array<{ catalogueId: string | null }>;

    expect(plans).toEqual([
      { id: 'plan-1', name: 'Sin bodega', warehouseId: 'wh-x', catalogueId: null },
    ]);
  });

  it('gives a different operator a different plan, never the union', async () => {
    const plans = await plansFor('op-2');

    expect(plans.map((plan) => plan.id)).toEqual(['plan-2']);
  });

  it('answers an unassigned operator with an empty list, not a raw plan listing', async () => {
    const plans = await plansFor('nobody');

    expect(plans).toEqual([]);
  });

  it('rejects a request with no operator as a 400 without reading any plan', async () => {
    const stub = db();

    const response = await handlePlans(stub, request(''));

    expect(response.status).toBe(400);
    expect(stub.calls.map((call) => call.table)).not.toContain('audit_plans');
  });

  it('scopes the assignment query by the operator profile', async () => {
    const stub = db();

    await handlePlans(stub, request('?operator=op-1'));

    const assignment = stub.calls.find((call) => call.table === 'plan_operators');
    expect(assignment?.filters).toContainEqual({ column: 'profile_id', value: 'op-1' });
  });
});

/**
 * "No tienes conteos asignados hoy." vs "we could not ask" — `PlansScreen` keeps
 * loading, error and ready as three distinct states precisely because those are
 * three distinct facts. supabase-js does NOT throw on a failed request; it
 * resolves `{data: null, error}`, so a route that reads only `data` turns a bad
 * key, a dropped connection or an RLS denial into a 200 with `[]` — the screen
 * then asserts, in the operator's own words, that they have no work today.
 *
 * Every one of these three lookups must therefore be able to fail LOUDLY.
 */
describe('GET /api/plans — a failed query is never an empty assignment list', () => {
  it('answers 502 when the assignment lookup fails', async () => {
    const stub = db({ errors: { 'select:plan_operators': 'JWT expired' } });

    const response = await handlePlans(stub, request('?operator=op-1'));

    expect(response.status).toBe(502);
    // Spanish, tú-form, and it says what happened — the same register as
    // `PlansScreen`'s own "No pudimos cargar tus conteos asignados." It must
    // never read as "you have no assignments".
    expect(await response.json()).toEqual({
      error: {
        code: 'db_unavailable',
        message: 'No pudimos consultar la base de datos. Intenta otra vez.',
      },
    });
  });

  it('answers 502 when the plan lookup fails', async () => {
    const stub = db({ errors: { 'select:audit_plans': 'connection reset' } });

    const response = await handlePlans(stub, request('?operator=op-1'));

    expect(response.status).toBe(502);
  });

  it('answers 502 when the warehouse lookup fails, rather than a null catalogue', async () => {
    const stub = db({ errors: { 'select:warehouses': 'permission denied' } });

    const response = await handlePlans(stub, request('?operator=op-1'));

    expect(response.status).toBe(502);
  });

  it('still answers 200 with [] for an operator who genuinely has no assignment', async () => {
    const response = await handlePlans(db(), request('?operator=nobody'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

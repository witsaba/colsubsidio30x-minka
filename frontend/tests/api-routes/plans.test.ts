/**
 * `GET /api/plans?operator=` (REQ-SDA-3 / REQ-OCF-8, RF-11).
 *
 * The screen this feeds used to list the eight matcher catalogues directly —
 * warehouse selection, not plan selection, which the PRD's own §6.1 callout
 * flags as the wrong flow. The route therefore must NEVER be able to answer
 * with a raw plan listing: an operator with no assignments gets `[]`, not
 * "everything".
 */
import { describe, expect, it } from 'vitest';

import { handlePlans, prerender } from '../../src/pages/api/plans';
import { createStubDb } from '../server/stub-db';

function request(query: string): Request {
  return new Request(`http://localhost:4321/api/plans${query}`);
}

function db() {
  return createStubDb({
    tables: {
      audit_plans: [
        { id: 'plan-1', status: 'active', name: 'Bodega A y B', warehouse_id: 'wh-1', catalogue_id: 'cat-1' },
        { id: 'plan-2', status: 'active', name: 'Bodega C', warehouse_id: 'wh-2', catalogue_id: 'cat-2' },
        { id: 'plan-3', status: 'closed', name: 'Cerrado', warehouse_id: 'wh-3', catalogue_id: 'cat-3' },
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
      { id: 'plan-1', name: 'Bodega A y B', warehouseId: 'wh-1', catalogueId: 'cat-1' },
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

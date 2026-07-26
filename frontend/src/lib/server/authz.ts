/**
 * Plan scoping — the RF-07 enforcement point (REQ-SDA-5, design D2).
 *
 * KNOWN TECHNICAL DEBT, named explicitly rather than hidden: the operator
 * identity arriving at a route is client-supplied (it is persisted from the
 * plan-selection screen), because this system has no login. What is REAL is the
 * assignment check: whoever the caller claims to be, they may only write
 * against a plan they are actually assigned to, on a plan that is actually
 * open. Substituting a real Supabase Auth session later changes where
 * `operatorId` comes from and nothing else in this module.
 *
 * RLS remains enabled on every operational table, but with no `auth.uid()` in
 * play it can only ever be defence in depth. This function is the decision.
 */
import type { Db } from './db';

export interface PlanScope {
  id: string;
  /** Needed by every count write and by the validation lookups. */
  warehouseId: string;
  /** The matcher catalogue this plan counts against (REQ-OCF-8). */
  catalogueId: string | null;
}

export type PlanAssignment = { ok: true; plan: PlanScope } | { ok: false; reason: string };

const ACTIVE = 'active';

function refuse(reason: string): PlanAssignment {
  return { ok: false, reason };
}

/**
 * Decide whether `operatorId` may act on `planId`.
 *
 * Order matters and is asserted by the tests: the assignment is resolved BEFORE
 * any operational data is read, so a refused caller never causes a single row
 * of `count_records` to be touched. Reading first and checking afterwards is
 * the classic shape of an authorization bug that only shows up in the logs.
 */
export async function assertPlanAssignment(
  db: Db,
  planId: string,
  operatorId: string,
): Promise<PlanAssignment> {
  const { data: assignment } = await db
    .from('plan_operators')
    .select('plan_id, profile_id')
    .eq('plan_id', planId)
    .eq('profile_id', operatorId)
    .maybeSingle();

  if (!assignment) return refuse('El operador no está asignado a este plan.');

  const { data: plan } = await db
    .from('audit_plans')
    .select('id, status, warehouse_id, catalogue_id')
    .eq('id', planId)
    .maybeSingle();

  if (!plan) return refuse('El plan no existe.');
  if (plan.status !== ACTIVE) return refuse('El plan no está activo.');

  return {
    ok: true,
    plan: {
      id: String(plan.id),
      warehouseId: String(plan.warehouse_id),
      catalogueId: typeof plan.catalogue_id === 'string' ? plan.catalogue_id : null,
    },
  };
}

/**
 * `GET /api/plans?operator=` — plan-based selection (REQ-SDA-3, REQ-OCF-8, RF-11).
 *
 * The operator picks an AUDIT PLAN, not a warehouse. The distinction is the
 * whole point of RF-11: a plan carries the warehouse, the period and the
 * assignment, so counting is scoped by something the auditor created rather
 * than by whatever catalogue the operator happened to tap.
 *
 * The query starts from `plan_operators` and never from `audit_plans`: an
 * operator with no assignments must get `[]`. Listing every plan and filtering
 * afterwards would be one forgotten `filter()` away from disclosing the whole
 * audit programme.
 */
import type { APIRoute } from 'astro';

import { supabase } from './_supabase';
import { supabaseDb } from '../../lib/server/db';
import type { Db } from '../../lib/server/db';
import { badRequest, json } from '../../lib/server/http';

export const prerender = false;

const ACTIVE = 'active';

export interface PlanSummary {
  id: string;
  name: string;
  warehouseId: string;
  catalogueId: string | null;
}

export async function handlePlans(db: Db, request: Request): Promise<Response> {
  const operatorId = new URL(request.url).searchParams.get('operator');
  if (!operatorId) return badRequest('Falta el parámetro operator.');

  const { data: assignments } = await db
    .from('plan_operators')
    .select('plan_id')
    .eq('profile_id', operatorId);

  const planIds = (assignments ?? []).map((row) => row.plan_id);
  // No assignment, no query: the operator sees nothing, and the database is
  // never asked a question whose answer could be a full listing.
  if (planIds.length === 0) return json([]);

  const { data: plans } = await db
    .from('audit_plans')
    .select('id, name, status, warehouse_id, catalogue_id')
    .in('id', planIds)
    .eq('status', ACTIVE);

  const summaries: PlanSummary[] = (plans ?? []).map((plan) => ({
    id: String(plan.id),
    name: String(plan.name ?? ''),
    warehouseId: String(plan.warehouse_id),
    catalogueId: typeof plan.catalogue_id === 'string' ? plan.catalogue_id : null,
  }));

  return json(summaries);
}

export const GET: APIRoute = ({ request }) => handlePlans(supabaseDb(supabase()), request);

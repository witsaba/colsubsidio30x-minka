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
 *
 * That `[]` is a CLAIM, so every read goes through `dataOrThrow`: an unanswerable
 * query becomes a 502, never the same empty list an unassigned operator gets.
 * `PlansScreen` distinguishes the two; this route now does too.
 */
import type { APIRoute } from 'astro';

import { supabase } from './_supabase';
import { dataOrThrow, supabaseDb } from '../../lib/server/db';
import type { Db } from '../../lib/server/db';
import { badRequest, json, respondingToDbFailure } from '../../lib/server/http';

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

  return respondingToDbFailure(async () => {
    const assignments = dataOrThrow(
      await db.from('plan_operators').select('plan_id').eq('profile_id', operatorId),
    );

    const planIds = (assignments ?? []).map((row) => row.plan_id);
    // No assignment, no query: the operator sees nothing, and the database is
    // never asked a question whose answer could be a full listing. This `[]` now
    // means only what it says — a failed lookup never reaches here.
    if (planIds.length === 0) return json([]);

    const plans = dataOrThrow(
      await db
        .from('audit_plans')
        .select('id, name, status, warehouse_id')
        .in('id', planIds)
        .eq('status', ACTIVE),
    );

    const rows = plans ?? [];

    // `audit_plans` has no `catalogue_id` column; the catalogue vocabulary IS
    // `warehouses.code` (change `redis-catalogue-cache`). One batched lookup
    // over the distinct warehouses, not one query per plan.
    const warehouseIds = [...new Set(rows.map((plan) => String(plan.warehouse_id)))];
    const warehouses = warehouseIds.length
      ? dataOrThrow(await db.from('warehouses').select('id, code').in('id', warehouseIds))
      : [];
    const codeByWarehouseId = new Map(
      (warehouses ?? []).map((warehouse) => [String(warehouse.id), warehouse.code]),
    );

    const summaries: PlanSummary[] = rows.map((plan) => {
      // A warehouse with no row is a real absence — the plan still ships with a
      // null catalogue. Only an ERRORING lookup is a failure.
      const code = codeByWarehouseId.get(String(plan.warehouse_id));
      return {
        id: String(plan.id),
        name: String(plan.name ?? ''),
        warehouseId: String(plan.warehouse_id),
        catalogueId: typeof code === 'string' ? code : null,
      };
    });

    return json(summaries);
  });
}

export const GET: APIRoute = ({ request }) => handlePlans(supabaseDb(supabase()), request);

/**
 * `POST /api/records` — persist one counted item (REQ-SDA-4/5, REQ-AV-2).
 *
 * Order of operations is the contract, and each step exists for a reason:
 *
 *   1. decode  — a malformed body never reaches the database;
 *   2. AUTHORIZE (RF-07) — `assertPlanAssignment` runs BEFORE any operational
 *      read or write, so a refused caller leaves no trace beyond the refusal;
 *   3. idempotency — the client mints `clientRecordId`, so a POST retried over
 *      a flaky connection resolves to the existing row instead of counting the
 *      same shelf twice. The column carries a unique index; this lookup is the
 *      cooperative half of that guarantee;
 *   4. RE-VALIDATE server-side — the client's verdict is advisory only. What
 *      the auditor reviews in `record_anomalies` must be what the SERVER
 *      computed, otherwise a tampered or merely stale client could suppress an
 *      anomaly (design D4);
 *   5. respond with the blind verdict — never the bounds (RF-18).
 */
import type { APIRoute } from 'astro';

import { supabase } from '../_supabase';
import { supabaseDb } from '../../../lib/server/db';
import type { Db } from '../../../lib/server/db';
import { assertPlanAssignment } from '../../../lib/server/authz';
import {
  badRequest,
  forbidden,
  json,
  optionalString,
  readJsonBody,
  requireNumber,
  requireString,
  serverError,
} from '../../../lib/server/http';
import {
  toOperatorVerdict,
  validateCount,
  type InternalAnomaly,
  type InternalVerdict,
} from '../../../lib/server/validation';

export const prerender = false;

/**
 * `count_records.status` values.
 *
 * NOTE (task 1.1): the live enum could not be re-verified in this apply session
 * (the Supabase MCP tools were unavailable to the executor). Centralised here
 * so reconciling with the real check constraint is a one-line change.
 */
export const COUNT_STATUS = {
  ok: 'confirmed',
  anomaly: 'flagged',
} as const;

interface RecordInput {
  clientRecordId: string;
  planId: string;
  operatorId: string;
  productId: string;
  quantity: number;
  unitCode: string | null;
  spokenName: string;
}

function readInput(body: Record<string, unknown>): RecordInput | null {
  const clientRecordId = requireString(body, 'clientRecordId');
  const planId = requireString(body, 'planId');
  const operatorId = requireString(body, 'operatorId');
  const productId = requireString(body, 'productId');
  const quantity = requireNumber(body, 'quantity');
  if (!clientRecordId || !planId || !operatorId || !productId || quantity === null) return null;

  return {
    clientRecordId,
    planId,
    operatorId,
    productId,
    quantity,
    unitCode: optionalString(body, 'unitCode'),
    spokenName: optionalString(body, 'spokenName') ?? '',
  };
}

/** The auditor-facing anomaly row. Figures live here, never on the wire. */
function anomalyRow(recordId: string, anomaly: InternalAnomaly): Record<string, unknown> {
  return {
    record_id: recordId,
    type: anomaly.type,
    severity: anomaly.severity,
    title: anomaly.title,
    detail: anomaly.detail,
    expected_unit_code: anomaly.expectedUnitCode,
    status: 'open',
  };
}

export async function handleCreateRecord(db: Db, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const input = readInput(body);
  if (!input) {
    return badRequest('Faltan clientRecordId, planId, operatorId, productId o quantity.');
  }

  const assignment = await assertPlanAssignment(db, input.planId, input.operatorId);
  if (!assignment.ok) return forbidden(assignment.reason);

  // Idempotency: a retried POST must resolve, not duplicate.
  const { data: existing } = await db
    .from('count_records')
    .select('id, status')
    .eq('client_record_id', input.clientRecordId)
    .maybeSingle();

  const verdict: InternalVerdict = await validateCount(db, {
    planId: input.planId,
    warehouseId: assignment.plan.warehouseId,
    productId: input.productId,
    quantity: input.quantity,
    unitCode: input.unitCode,
  });

  if (existing) {
    return json({ id: existing.id, ...toOperatorVerdict(verdict) }, 200);
  }

  const { data: created, error } = await db
    .from('count_records')
    .insert({
      plan_id: input.planId,
      warehouse_id: assignment.plan.warehouseId,
      product_id: input.productId,
      quantity: input.quantity,
      unit_code: input.unitCode,
      source: 'voice',
      status: verdict.anomaly ? COUNT_STATUS.anomaly : COUNT_STATUS.ok,
      dictated_text: input.spokenName,
      counted_by: input.operatorId,
      client_record_id: input.clientRecordId,
      is_deleted: false,
    })
    .select()
    .single();

  if (error || !created) {
    return serverError(`No se pudo guardar el conteo: ${error?.message ?? 'sin datos'}`);
  }

  if (verdict.anomaly) {
    // Best-effort by design: the count itself is already durable, and losing the
    // count because its annotation failed would be the worse outcome. The
    // failure is surfaced in the server log, not swallowed into the response.
    const { error: anomalyError } = await db
      .from('record_anomalies')
      .insert(anomalyRow(String(created.id), verdict.anomaly))
      .select();
    if (anomalyError) {
      console.error('record_anomalies insert failed', { recordId: created.id, error: anomalyError });
    }
  }

  return json({ id: created.id, ...toOperatorVerdict(verdict) }, 201);
}

export const POST: APIRoute = ({ request }) => handleCreateRecord(supabaseDb(supabase()), request);

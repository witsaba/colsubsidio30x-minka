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
import { dataOrThrow, supabaseDb } from '../../../lib/server/db';
import type { Db } from '../../../lib/server/db';
import { assertPlanAssignment } from '../../../lib/server/authz';
import { resolveProductId } from '../../../lib/server/products';
import {
  badRequest,
  forbidden,
  json,
  optionalString,
  readJsonBody,
  requireNumber,
  requireString,
  respondingToDbFailure,
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
 * `count_records.status` values (`record_status` enum).
 *
 * Verified against the live schema (orchestrator, MCP `list_tables(verbose)`,
 * project blvdxsoaopcvtzawvgbt): `pending_sync | recorded | flagged | verified
 * | discarded`. `'confirmed'` — this constant's original value — is NOT a
 * member; every non-anomaly write would have hit the check constraint and
 * 500'd in production. `recorded` is the column's own default, matching the
 * "voice inserts only" success state (RF-20).
 */
export const COUNT_STATUS = {
  ok: 'recorded',
  anomaly: 'flagged',
} as const;

interface RecordInput {
  clientRecordId: string;
  planId: string;
  operatorId: string;
  /** Null when the caller identified the article by `nrArticulo` instead. */
  productId: string | null;
  nrArticulo: string | null;
  /** The matcher's catalogue name — the `products.name_normalized` fallback. */
  articulo: string | null;
  quantity: number;
  unitCode: string | null;
  spokenName: string;
}

function readInput(body: Record<string, unknown>): RecordInput | null {
  const clientRecordId = requireString(body, 'clientRecordId');
  const planId = requireString(body, 'planId');
  const operatorId = requireString(body, 'operatorId');
  const productId = optionalString(body, 'productId');
  const nrArticulo = optionalString(body, 'nrArticulo');
  const articulo = optionalString(body, 'articulo');
  const spokenName = optionalString(body, 'spokenName') ?? '';
  const quantity = requireNumber(body, 'quantity');
  if (!clientRecordId || !planId || !operatorId || quantity === null) return null;
  // SOME article identity must be present. `sku` is null for ~18.4% of the
  // catalogue (task 6.10), so the catalogue name is a first-class identity here
  // and not merely descriptive text.
  if (!productId && !nrArticulo && !articulo && !spokenName) return null;

  return {
    clientRecordId,
    planId,
    operatorId,
    productId,
    nrArticulo,
    articulo,
    quantity,
    unitCode: optionalString(body, 'unitCode'),
    spokenName,
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
    return badRequest('Faltan clientRecordId, planId, operatorId, quantity o la identidad del artículo.');
  }

  /*
   * The boundary opens HERE, not at the idempotency read.
   *
   * `assertPlanAssignment` and `resolveProductId` both raise
   * `DbUnavailableError` rather than returning a verdict they could not compute,
   * and both used to run outside this wrapper — so their throw would have
   * escaped the handler entirely instead of becoming the 502 that says so. The
   * decode above stays outside on purpose: a 400 is decided without the database.
   */
  return respondingToDbFailure(async () => {
    const assignment = await assertPlanAssignment(db, input.planId, input.operatorId);
    if (!assignment.ok) return forbidden(assignment.reason);

    // AFTER the RF-07 guard: an unauthorized caller must not be able to probe the
    // catalogue for which article codes exist.
    const productId: string | null = await resolveProductId(db, input);
    if (!productId) return badRequest('No encontramos ese artículo en el catálogo.');

    /*
     * Idempotency: a retried POST must resolve, not duplicate.
     *
     * `dataOrThrow` is load-bearing here, not defensive. Read as "no existing
     * row", a failed lookup lets the route fall through to the INSERT, and the
     * only thing left between a flaky connection and a double-counted shelf is
     * the unique index on `client_record_id` — whose violation this route
     * reports as a plain 500 with no id. A 502 writes nothing and the client may
     * retry the SAME key. `null` still means "no such row" and inserts.
     */
    const existing = dataOrThrow(
      await db
        .from('count_records')
        .select('id, status')
        .eq('client_record_id', input.clientRecordId)
        .maybeSingle(),
    );

    const verdict: InternalVerdict = await validateCount(db, {
      planId: input.planId,
      warehouseId: assignment.plan.warehouseId,
      productId,
      quantity: input.quantity,
      unitCode: input.unitCode,
    });

    if (existing) {
      return json({ id: existing.id, ...toOperatorVerdict(verdict) }, 200);
    }

    // Still `serverError`, not `dataOrThrow`: a write we ATTEMPTED and lost is a
    // 500. The 502 above says the database was never asked.
    const { data: created, error } = await db
      .from('count_records')
      .insert({
        plan_id: input.planId,
        warehouse_id: assignment.plan.warehouseId,
        product_id: productId,
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
        console.error('record_anomalies insert failed', {
          recordId: created.id,
          error: anomalyError,
        });
      }
    }

    return json({ id: created.id, ...toOperatorVerdict(verdict) }, 201);
  });
}

export const POST: APIRoute = ({ request }) => handleCreateRecord(supabaseDb(supabase()), request);

/* -------------------------------------------------------------------------- */
/* GET — session resume (REQ-OCF-13)                                          */
/* -------------------------------------------------------------------------- */

/**
 * One persisted count, as the OPERATOR's own list restores it.
 *
 * `id` is the CLIENT-minted `client_record_id`, not the server uuid. That is the
 * whole point of the route: the id is also the idempotency key, so a resumed
 * session that invented a new one would write a second row for the same shelf.
 *
 * The shape is deliberately the blind one. `anomaly` carries the same
 * `{type, severity, title}` triple `toOperatorVerdict` allows through on the
 * write path and nothing else — no `detail`, no bound, no theoretical stock
 * (RF-18). This is an operator route; blindness is not relaxed just because the
 * facts were already shown once.
 */
export interface RestoredRecord {
  /** `count_records.client_record_id` — the idempotency key, reused verbatim. */
  id: string;
  /** `count_records.id` — what a later soft delete is issued against. */
  serverId: string;
  quantity: number;
  unitCode: string | null;
  /** `units.label_es`; null when the code has no Spanish label (REQ-OCF-7). */
  unitDisplay: string | null;
  articulo: string;
  nrArticulo: string | null;
  spokenName: string;
  state: 'ok' | 'anom_noted';
  anomaly: { type: string; severity: string; title: string } | null;
  createdAt: string;
}

export async function handleListRecords(db: Db, request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const planId = params.get('planId');
  const operatorId = params.get('operatorId');
  if (!planId || !operatorId) return badRequest('Faltan los parámetros planId y operatorId.');

  return respondingToDbFailure(async () => {
    // RF-07 FIRST, exactly as on the write path. A read is not a lesser right:
    // this list is what was counted in a plan, and an unassigned caller must not
    // be able to enumerate it — or to probe which plans hold data.
    //
    // Inside the boundary, also exactly as on the write path: the guard reads
    // three tables, and a 403 it could not actually decide would tell the
    // operator their own plan is not theirs.
    const assignment = await assertPlanAssignment(db, planId, operatorId);
    if (!assignment.ok) return forbidden(assignment.reason);

    const rows = dataOrThrow(
      await db
        .from('count_records')
        .select(
          'id, client_record_id, product_id, quantity, unit_code, status, dictated_text, created_at, is_deleted',
        )
        .eq('plan_id', planId)
        .eq('counted_by', operatorId)
        // RF-21: a soft-deleted row was CORRECTED. Restoring it would show the
        // operator their own shelf counted twice.
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
    );

    const records = rows ?? [];
    // A genuinely empty resume. Reached only when the read SUCCEEDED — the
    // alternative is an operator who re-dictates a shelf they already counted
    // under a fresh `client_record_id`, which the idempotency key can no longer
    // match.
    if (records.length === 0) return json([]);

    const ids = records.map((row) => String(row.id));
    const anomalyRows = dataOrThrow(
      await db
        .from('record_anomalies')
        // The projection is the guard: `detail` and `expected_unit_code` are not
        // selected at all, so there is no field to forget to strip later.
        .select('record_id, type, severity, title')
        .in('record_id', ids),
    );

    const anomalyByRecord = new Map(
      (anomalyRows ?? []).map((row) => [
        String(row.record_id),
        {
          type: String(row.type),
          severity: String(row.severity),
          title: String(row.title ?? ''),
        },
      ]),
    );

    const productRows = dataOrThrow(
      await db
        .from('products')
        .select('id, sku, name')
        .in('id', [...new Set(records.map((row) => String(row.product_id)))]),
    );
    const products = new Map((productRows ?? []).map((row) => [String(row.id), row]));

    // A code with no `units` row keeps a null `unitDisplay` (REQ-OCF-7); only a
    // failed label read refuses.
    const unitCodes = [...new Set(records.map((row) => row.unit_code).filter(Boolean))];
    const unitRows = unitCodes.length
      ? dataOrThrow(await db.from('units').select('code, label_es').in('code', unitCodes))
      : [];
    const unitLabels = new Map(
      (unitRows ?? []).map((row) => [String(row.code), row.label_es ?? null]),
    );

    const payload: RestoredRecord[] = records.map((row) => {
      const product = products.get(String(row.product_id));
      const anomaly = anomalyByRecord.get(String(row.id)) ?? null;
      return {
        id: String(row.client_record_id ?? row.id),
        serverId: String(row.id),
        quantity: Number(row.quantity),
        unitCode: row.unit_code ?? null,
        unitDisplay: row.unit_code ? (unitLabels.get(String(row.unit_code)) ?? null) : null,
        articulo: String(product?.name ?? ''),
        nrArticulo: product?.sku ?? null,
        spokenName: String(row.dictated_text ?? ''),
        // A restored record is SETTLED. It can never come back as `sync`, or the
        // client would fire a write for a row that already exists.
        state: row.status === COUNT_STATUS.anomaly ? 'anom_noted' : 'ok',
        anomaly,
        createdAt: String(row.created_at ?? ''),
      };
    });

    return json(payload);
  });
}

export const GET: APIRoute = ({ request }) => handleListRecords(supabaseDb(supabase()), request);

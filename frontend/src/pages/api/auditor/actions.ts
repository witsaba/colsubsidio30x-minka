/**
 * `POST /api/auditor/actions` — the audit trail (REQ-AUD-4, RF-32, design D7).
 *
 * APPEND-ONLY. Every approval, correction, rejection and recount request adds a
 * row; nothing is ever updated. The trail's job is to answer "what did the
 * auditor do, and when", and a mutated row can only answer "what do they claim
 * now".
 *
 * The client is PESSIMISTIC against this route: the trace entry appears in the
 * auditor's UI only after this returns 2xx, so a signature can never exist on
 * screen without existing in `auditor_actions`.
 */
import type { APIRoute } from 'astro';

import { supabase } from '../_supabase';
import { supabaseDb } from '../../../lib/server/db';
import type { Db } from '../../../lib/server/db';
import {
  badRequest,
  failure,
  json,
  optionalString,
  readJsonBody,
  requireString,
  serverError,
} from '../../../lib/server/http';

export const prerender = false;

const ACTIONS = ['approve', 'correct', 'reject', 'request_recount'] as const;
type AuditorActionVerb = (typeof ACTIONS)[number];

function isAction(value: string): value is AuditorActionVerb {
  return (ACTIONS as readonly string[]).includes(value);
}

/**
 * The two verbs that SETTLE a count (task 6.14).
 *
 * `approve` accepts the operator's figure, `correct` replaces it with the
 * auditor's own — either way the dispute is over and the record may ship.
 * `reject` and `request_recount` are deliberately absent: they leave the
 * anomaly open, which is exactly what keeps an unreconciled figure out of the
 * Oracle export (`lib/server/export.ts` `isEligible`).
 */
const SETTLING_ACTIONS = new Set<AuditorActionVerb>(['approve', 'correct']);

/**
 * Move the record out of the auditor's queue: resolve its open anomalies and
 * mark the count verified.
 *
 * Without this, the append-only trail recorded an approval that changed
 * nothing: the anomaly stayed `'open'` forever and the export silently dropped
 * the record on every run, with no error surfaced anywhere.
 *
 * Returns an error message, or `null` on success.
 */
async function settleRecord(
  db: Db,
  recordId: string,
  auditorId: string,
  note: string | null,
): Promise<string | null> {
  const { error: anomalyError } = await db
    .from('record_anomalies')
    .update({
      status: 'resolved',
      resolved_by: auditorId,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    })
    .eq('record_id', recordId)
    .eq('status', 'open');
  if (anomalyError) return anomalyError.message;

  const { error: recordError } = await db
    .from('count_records')
    .update({ status: 'verified' })
    .eq('id', recordId);
  return recordError ? recordError.message : null;
}

export async function handleAuditorAction(db: Db, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const auditorId = requireString(body, 'auditorId');
  const recordId = requireString(body, 'recordId');
  const action = requireString(body, 'action');
  if (!auditorId || !recordId || !action) return badRequest('Faltan auditorId, recordId o action.');
  if (!isAction(action)) return badRequest(`Acción no reconocida: ${action}.`);

  const { data: record } = await db
    .from('count_records')
    // `plan_id`/`product_id` are read here, not asked of the client: they are
    // NOT NULL on `recount_requests` and the stored row is the only trustworthy
    // source for them.
    .select('id, plan_id, product_id, quantity, unit_code')
    .eq('id', recordId)
    .maybeSingle();
  if (!record) return failure(404, 'not_found', 'El registro no existe.');

  // The "previous" side is read from the STORED row, never from the request:
  // the trail must record what was actually there, not what the client believed.
  const previousQuantity = Number(record.quantity);
  const previousUnitCode = record.unit_code ?? null;
  const newQuantity = typeof body.newQuantity === 'number' ? body.newQuantity : previousQuantity;
  const newUnitCode = optionalString(body, 'newUnitCode') ?? previousUnitCode;
  const note = optionalString(body, 'note');

  const { data: created, error } = await db
    .from('auditor_actions')
    // Column names are the LIVE ones (`actor_id`, `reason`), which deliberately
    // differ from this route's request-body names (`auditorId`, `note`). The
    // wire contract belongs to the client; these belong to Postgres.
    .insert({
      record_id: recordId,
      actor_id: auditorId,
      action,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      previous_unit_code: previousUnitCode,
      new_unit_code: newUnitCode,
      reason: note,
    })
    .select()
    .single();

  if (error || !created) {
    return serverError(`No se pudo registrar la acción: ${error?.message ?? 'sin datos'}`);
  }

  if (action === 'request_recount') {
    const { error: recountError } = await db
      .from('recount_requests')
      .insert({
        record_id: recordId,
        plan_id: record.plan_id,
        product_id: record.product_id,
        requested_by: auditorId,
        // `recount_status` is requested|in_progress|done|cancelled. It is NOT
        // the `record_anomalies` vocabulary, and the free text column here is
        // `note`, not `reason` — the opposite of `auditor_actions` above.
        status: 'requested',
        note,
      })
      .select();
    if (recountError) {
      return serverError(`No se pudo crear la solicitud de reconteo: ${recountError.message}`);
    }
  }

  if (SETTLING_ACTIONS.has(action)) {
    const settleError = await settleRecord(db, recordId, auditorId, note);
    if (settleError) {
      return serverError(`No se pudo cerrar el registro: ${settleError}`);
    }
  }

  return json({ id: created.id, action }, 201);
}

export const POST: APIRoute = ({ request }) => handleAuditorAction(supabaseDb(supabase()), request);

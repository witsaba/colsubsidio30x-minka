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
    .select('id, quantity, unit_code')
    .eq('id', recordId)
    .maybeSingle();
  if (!record) return failure(404, 'not_found', 'El registro no existe.');

  // The "previous" side is read from the STORED row, never from the request:
  // the trail must record what was actually there, not what the client believed.
  const previousQuantity = Number(record.quantity);
  const previousUnitCode = record.unit_code ?? null;
  const newQuantity = typeof body.newQuantity === 'number' ? body.newQuantity : previousQuantity;
  const newUnitCode = optionalString(body, 'newUnitCode') ?? previousUnitCode;

  const { data: created, error } = await db
    .from('auditor_actions')
    .insert({
      record_id: recordId,
      auditor_id: auditorId,
      action,
      previous_quantity: previousQuantity,
      new_quantity: newQuantity,
      previous_unit_code: previousUnitCode,
      new_unit_code: newUnitCode,
      note: optionalString(body, 'note'),
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
        requested_by: auditorId,
        status: 'open',
        reason: optionalString(body, 'note'),
      })
      .select();
    if (recountError) {
      return serverError(`No se pudo crear la solicitud de reconteo: ${recountError.message}`);
    }
  }

  return json({ id: created.id, action }, 201);
}

export const POST: APIRoute = ({ request }) => handleAuditorAction(supabaseDb(supabase()), request);

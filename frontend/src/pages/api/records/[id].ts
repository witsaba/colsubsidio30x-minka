/**
 * `DELETE /api/records/[id]` — touch-only correction (REQ-SDA-4, RF-20/21, D6).
 *
 * The HTTP verb is DELETE because that is what the gesture means to the
 * operator. What it performs is an UPDATE: `is_deleted = true` plus who, when
 * and why. The original quantity is never overwritten and the row is never
 * removed — the whole point of delete-and-redo is that the auditor can still
 * see what was first dictated and what replaced it.
 *
 * A redo is a NEW `POST /api/records`, never an update of this row: voice
 * creates records and never edits them (RF-20).
 */
import type { APIRoute } from 'astro';

import { supabase } from '../_supabase';
import { dataOrThrow, supabaseDb } from '../../../lib/server/db';
import type { Db } from '../../../lib/server/db';
import { assertPlanAssignment } from '../../../lib/server/authz';
import {
  badRequest,
  failure,
  json,
  optionalString,
  readJsonBody,
  requireString,
  forbidden,
  respondingToDbFailure,
  serverError,
} from '../../../lib/server/http';

export const prerender = false;

export async function handleDeleteRecord(db: Db, id: string, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const operatorId = requireString(body, 'operatorId');
  if (!operatorId) return badRequest('Falta operatorId.');

  return respondingToDbFailure(async () => {
    // 404 is a CLAIM about the row — "it is not there" — and the operator reads
    // it as their correction having already been applied. A failed lookup cannot
    // support that claim, so it becomes a 502; `null` still means no such row.
    const record = dataOrThrow(
      await db.from('count_records').select('id, plan_id').eq('id', id).maybeSingle(),
    );
    if (!record) return failure(404, 'not_found', 'El registro no existe.');

    // The plan comes from the STORED row, never from the request: otherwise a
    // caller could name a plan they happen to be assigned to and delete somebody
    // else's record (RF-07).
    const assignment = await assertPlanAssignment(db, String(record.plan_id), operatorId);
    if (!assignment.ok) return forbidden(assignment.reason);

    const { error } = await db
      .from('count_records')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: operatorId,
        delete_reason: optionalString(body, 'reason'),
      })
      .eq('id', id);

    if (error) return serverError(`No se pudo eliminar el registro: ${error.message}`);

    return json({ id, deleted: true });
  });
}

export const DELETE: APIRoute = ({ request, params }) =>
  handleDeleteRecord(supabaseDb(supabase()), String(params.id), request);

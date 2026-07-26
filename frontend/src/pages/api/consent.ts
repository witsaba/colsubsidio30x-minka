/**
 * `POST /api/consent` — S1 voice-capture consent (REQ-SDA-2, RNF-04).
 *
 * The write is BLOCKING on the client side (design D5): `MIC_GRANTED` is only
 * dispatched after this route answers 2xx. Consent is the one legally
 * significant fact in the operator flow, so "recorded locally, maybe uploaded
 * later" is not an acceptable state — either the row exists or the operator
 * does not start counting.
 *
 * Consequently a failed insert MUST surface as a 5xx. Returning 2xx on a failed
 * write would produce exactly the situation the table exists to prevent: voice
 * captured with no evidence of consent.
 */
import type { APIRoute } from 'astro';

import { supabase } from './_supabase';
import { supabaseDb } from '../../lib/server/db';
import type { Db } from '../../lib/server/db';
import { badRequest, json, optionalString, readJsonBody, requireString, serverError } from '../../lib/server/http';

export const prerender = false;

const DEFAULT_POLICY_VERSION = 'v1';

export async function handleConsent(db: Db, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const operatorId = requireString(body, 'operatorId');
  if (!operatorId) return badRequest('Falta operatorId.');

  const { data, error } = await db
    .from('voice_consents')
    .insert({
      profile_id: operatorId,
      status: 'granted',
      policy_version: optionalString(body, 'policyVersion') ?? DEFAULT_POLICY_VERSION,
      // The header is evidence of WHICH device consented; a missing one is
      // recorded as null rather than as an invented placeholder.
      user_agent: request.headers.get('user-agent'),
    })
    .select()
    .single();

  if (error || !data) {
    return serverError(`No se pudo registrar el consentimiento: ${error?.message ?? 'sin datos'}`);
  }

  return json({ id: data.id }, 201);
}

export const POST: APIRoute = ({ request }) => handleConsent(supabaseDb(supabase()), request);

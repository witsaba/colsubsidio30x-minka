/**
 * `POST /api/anomaly-check` — the operator-facing validation edge (REQ-AV-1/3).
 *
 * This is what `httpAnomalyEngine` calls while the confirm sheet is being
 * prepared. Its response is the ONLY thing the operator's device ever learns
 * about the catalogue statistics, so it is serialized exclusively through
 * `toOperatorVerdict` (RF-18). The internal verdict — bounds, theoretical
 * balance — stays on this side of the wire.
 *
 * The verdict returned here is advisory: `POST /api/records` re-runs the very
 * same validation server-side before writing `record_anomalies`, so a tampered
 * client verdict cannot alter what the auditor sees (design D4).
 */
import type { APIRoute } from 'astro';

import { supabase } from './_supabase';
import { supabaseDb } from '../../lib/server/db';
import type { Db } from '../../lib/server/db';
import { badRequest, json, optionalString, readJsonBody, requireNumber, requireString } from '../../lib/server/http';
import { toOperatorVerdict, validateCount, type CountFacts } from '../../lib/server/validation';

export const prerender = false;

/** Decode the request body into validation facts, or `null` when malformed. */
export function readCountFacts(body: Record<string, unknown>): CountFacts | null {
  const planId = requireString(body, 'planId');
  const warehouseId = requireString(body, 'warehouseId');
  const productId = requireString(body, 'productId');
  const quantity = requireNumber(body, 'quantity');
  if (!planId || !warehouseId || !productId || quantity === null) return null;

  return { planId, warehouseId, productId, quantity, unitCode: optionalString(body, 'unitCode') };
}

/** Injectable handler: tests drive it with a stub `Db`, Astro with the real one. */
export async function handleAnomalyCheck(db: Db, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const facts = readCountFacts(body);
  if (!facts) return badRequest('Faltan planId, warehouseId, productId o quantity.');

  return json(toOperatorVerdict(await validateCount(db, facts)));
}

export const POST: APIRoute = ({ request }) => handleAnomalyCheck(supabaseDb(supabase()), request);

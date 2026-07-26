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
import { resolveProductId } from '../../lib/server/products';
import { toOperatorVerdict, validateCount, type CountFacts } from '../../lib/server/validation';

export const prerender = false;

/**
 * Validation facts still missing their product uuid.
 *
 * The article arrives as EITHER a `products.id` or the matcher's `nr_articulo`
 * (see `lib/server/products.ts`), so the decode cannot produce `CountFacts`
 * on its own — resolving needs the database.
 */
type PendingFacts = Omit<CountFacts, 'productId'> & {
  productId: string | null;
  nrArticulo: string | null;
  /** The matcher's catalogue name — the `products.name_normalized` fallback. */
  articulo: string | null;
};

/** Decode the request body into validation facts, or `null` when malformed. */
export function readCountFacts(body: Record<string, unknown>): PendingFacts | null {
  const planId = requireString(body, 'planId');
  const warehouseId = requireString(body, 'warehouseId');
  const productId = optionalString(body, 'productId');
  const nrArticulo = optionalString(body, 'nrArticulo');
  const articulo = optionalString(body, 'articulo');
  const quantity = requireNumber(body, 'quantity');
  if (!planId || !warehouseId || quantity === null) return null;
  // The catalogue name is a real identity, not decoration: `sku` is null for
  // ~18.4% of the catalogue and `name_normalized` is the fallback key (6.10).
  if (!productId && !nrArticulo && !articulo) return null;

  return {
    planId,
    warehouseId,
    productId,
    nrArticulo,
    articulo,
    quantity,
    unitCode: optionalString(body, 'unitCode'),
  };
}

/** Injectable handler: tests drive it with a stub `Db`, Astro with the real one. */
export async function handleAnomalyCheck(db: Db, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const pending = readCountFacts(body);
  if (!pending) {
    return badRequest('Faltan planId, warehouseId, quantity o la identidad del artículo.');
  }

  const productId = await resolveProductId(db, pending);
  if (!productId) return badRequest('No encontramos ese artículo en el catálogo.');

  const facts: CountFacts = {
    planId: pending.planId,
    warehouseId: pending.warehouseId,
    productId,
    quantity: pending.quantity,
    unitCode: pending.unitCode,
  };

  return json(toOperatorVerdict(await validateCount(db, facts)));
}

export const POST: APIRoute = ({ request }) => handleAnomalyCheck(supabaseDb(supabase()), request);

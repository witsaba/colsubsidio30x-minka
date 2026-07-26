/**
 * `GET /api/auditor/records?plan=` — the auditor review feed (REQ-AUD-3).
 *
 * Replaces the eight hardcoded fixtures with what the operators actually
 * counted. Soft-deleted rows are filtered out: they were corrected, and showing
 * them would present a shelf as counted twice.
 *
 * The auditor MAY see figures — RF-18's blindness binds the operator tablet
 * only (REQ-AUD-1/2 are explicit about this), so no allowlist projection is
 * applied here. What is NOT sent is anything the dashboard does not render.
 */
import type { APIRoute } from 'astro';

import { supabase } from '../_supabase';
import { supabaseDb } from '../../../lib/server/db';
import type { Db } from '../../../lib/server/db';
import { badRequest, json } from '../../../lib/server/http';

export const prerender = false;

export interface AuditorAnomaly {
  type: string;
  severity: string;
  title: string;
  status: string;
}

export interface AuditorRecord {
  id: string;
  quantity: number;
  unitCode: string | null;
  articulo: string;
  nrArticulo: string | null;
  spokenName: string;
  status: string;
  countedBy: string | null;
  anomalies: AuditorAnomaly[];
}

export async function handleAuditorRecords(db: Db, request: Request): Promise<Response> {
  const planId = new URL(request.url).searchParams.get('plan');
  if (!planId) return badRequest('Falta el parámetro plan.');

  const { data: rows } = await db
    .from('count_records')
    .select('id, product_id, quantity, unit_code, counted_by, status, dictated_text, is_deleted')
    .eq('plan_id', planId)
    .eq('is_deleted', false);

  const records = rows ?? [];
  const ids = records.map((row) => String(row.id));

  const { data: anomalyRows } = ids.length
    ? await db
        .from('record_anomalies')
        .select('record_id, type, severity, title, status')
        .in('record_id', ids)
    : { data: [] };

  const byRecord = new Map<string, AuditorAnomaly[]>();
  for (const row of anomalyRows ?? []) {
    const list = byRecord.get(String(row.record_id)) ?? [];
    list.push({
      type: String(row.type),
      severity: String(row.severity),
      title: String(row.title ?? ''),
      status: String(row.status ?? ''),
    });
    byRecord.set(String(row.record_id), list);
  }

  const { data: productRows } = ids.length
    ? await db
        .from('products')
        .select('id, sku, name')
        .in('id', [...new Set(records.map((row) => String(row.product_id)))])
    : { data: [] };
  const products = new Map((productRows ?? []).map((row) => [String(row.id), row]));

  const payload: AuditorRecord[] = records.map((row) => {
    const product = products.get(String(row.product_id));
    return {
      id: String(row.id),
      quantity: Number(row.quantity),
      unitCode: row.unit_code ?? null,
      articulo: String(product?.name ?? ''),
      nrArticulo: product?.sku ?? null,
      spokenName: String(row.dictated_text ?? ''),
      status: String(row.status ?? ''),
      countedBy: row.counted_by ?? null,
      // Always an array: an empty list is "no anomalies", a missing field would
      // be "unknown", and the dashboard must not have to tell them apart.
      anomalies: byRecord.get(String(row.id)) ?? [],
    };
  });

  return json(payload);
}

export const GET: APIRoute = ({ request }) => handleAuditorRecords(supabaseDb(supabase()), request);

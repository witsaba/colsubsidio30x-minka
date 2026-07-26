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

/** One persisted `auditor_actions` row, as the dashboard's trace reads it. */
export interface AuditorActionEntry {
  action: string;
  note: string | null;
  /** Signing auditor's name; null when the profile row is unavailable. */
  auditor: string | null;
  createdAt: string;
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
  /** Theoretical stock for this (warehouse, product); null when none exists. */
  systemQty: number | null;
  systemUnitCode: string | null;
  /** The RF-32 trail, oldest first. Empty when nobody has acted yet. */
  actions: AuditorActionEntry[];
}

/** `warehouse_stock_balances` is keyed by the PAIR, never by the product alone. */
function balanceKey(warehouseId: unknown, productId: unknown): string {
  return `${String(warehouseId)}\u0000${String(productId)}`;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
}

export async function handleAuditorRecords(db: Db, request: Request): Promise<Response> {
  const planId = new URL(request.url).searchParams.get('plan');
  if (!planId) return badRequest('Falta el parámetro plan.');

  const { data: rows } = await db
    .from('count_records')
    .select(
      'id, warehouse_id, product_id, quantity, unit_code, counted_by, status, dictated_text, is_deleted',
    )
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

  /*
   * REQ-AUD-2 (task 6.6): the theoretical stock behind "Contado vs Sistema".
   *
   * Auditor-only by design contract C6 — RF-18's blind counting binds the
   * OPERATOR routes (`/api/records`, `/api/anomaly-check`), and the auditor is
   * precisely the role that must see both figures to judge a difference.
   *
   * Filtered on BOTH ids and keyed on the pair: the same product exists in many
   * warehouses, and reading another bodega's balance would present a stock the
   * counted shelf never held.
   */
  const warehouseIds = [...new Set(records.map((row) => String(row.warehouse_id)))];
  const { data: balanceRows } = ids.length
    ? await db
        .from('warehouse_stock_balances')
        .select('warehouse_id, product_id, unit_code, theoretical_qty')
        .in('warehouse_id', warehouseIds)
        .in('product_id', [...new Set(records.map((row) => String(row.product_id)))])
    : { data: [] };
  const balances = new Map(
    (balanceRows ?? []).map((row) => [balanceKey(row.warehouse_id, row.product_id), row]),
  );

  /*
   * REQ-AUD-4 / RF-32 (task 6.7): the trail READ BACK.
   *
   * `POST /api/auditor/actions` has always written these rows, but nothing read
   * them, so every decision vanished from the screen on reload while the
   * database still held it. Oldest first — `toAuditorRecord` reverses it for
   * display, and the storage order is the one the trail actually happened in.
   */
  const { data: actionRows } = ids.length
    ? await db
        .from('auditor_actions')
        .select('record_id, actor_id, action, reason, created_at')
        .in('record_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] };

  const auditorIds = [...new Set((actionRows ?? []).map((row) => String(row.actor_id)))];
  const { data: auditorRows } = auditorIds.length
    ? await db.from('profiles').select('id, full_name').in('id', auditorIds)
    : { data: [] };
  const auditorNames = new Map(
    (auditorRows ?? []).map((row) => [String(row.id), row.full_name ?? null]),
  );

  const actionsByRecord = new Map<string, AuditorActionEntry[]>();
  for (const row of actionRows ?? []) {
    const list = actionsByRecord.get(String(row.record_id)) ?? [];
    list.push({
      action: String(row.action),
      note: row.reason ?? null,
      auditor: auditorNames.get(String(row.actor_id)) ?? null,
      createdAt: String(row.created_at),
    });
    actionsByRecord.set(String(row.record_id), list);
  }

  const payload: AuditorRecord[] = records.map((row) => {
    const product = products.get(String(row.product_id));
    const balance = balances.get(balanceKey(row.warehouse_id, row.product_id));
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
      // Null, never 0: no balance row means the system holds no figure for this
      // shelf, which is a different fact from a stock of zero.
      systemQty: balance ? numberOrNull(balance.theoretical_qty) : null,
      systemUnitCode: balance?.unit_code ?? null,
      actions: actionsByRecord.get(String(row.id)) ?? [],
    };
  });

  return json(payload);
}

export const GET: APIRoute = ({ request }) => handleAuditorRecords(supabaseDb(supabase()), request);

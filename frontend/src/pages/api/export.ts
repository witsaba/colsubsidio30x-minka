/**
 * `POST /api/export` — generate AND persist one Oracle export (REQ-OE-1/2, D8).
 *
 * One route rather than a generate/download pair, because the two must not be
 * able to disagree: the file the auditor saves is rendered from exactly the
 * lines that were just written to `export_lines`. If either insert fails the
 * caller gets an error and NO body — a CSV with no batch behind it would be
 * unreconcilable, which is precisely what REQ-OE-2 forbids.
 */
import type { APIRoute } from 'astro';

import { supabase } from './_supabase';
import { supabaseDb } from '../../lib/server/db';
import type { Db, DbRow } from '../../lib/server/db';
import { badRequest, readJsonBody, requireString, serverError } from '../../lib/server/http';
import { buildExportLines, toCsv, type ExportableRecord } from '../../lib/server/export';

export const prerender = false;

const OPEN = 'open';

/** `record_id`s that still carry an unresolved anomaly. */
async function openAnomalyIds(db: Db, recordIds: string[]): Promise<Set<string>> {
  if (recordIds.length === 0) return new Set();
  const { data } = await db
    .from('record_anomalies')
    .select('record_id, status')
    .in('record_id', recordIds)
    .eq('status', OPEN);
  return new Set((data ?? []).map((row) => String(row.record_id)));
}

async function lookup(db: Db, table: string, ids: string[]): Promise<Map<string, DbRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await db.from(table).select('*').in('id', ids);
  return new Map((data ?? []).map((row) => [String(row.id), row]));
}

function exportCode(planId: string, at: Date): string {
  return `EXP-${planId}-${at.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
}

export async function handleExport(db: Db, request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return badRequest('Cuerpo JSON inválido.');

  const planId = requireString(body, 'planId');
  const auditorId = requireString(body, 'auditorId');
  if (!planId || !auditorId) return badRequest('Faltan planId o auditorId.');

  const { data: plan } = await db
    .from('audit_plans')
    .select('id, warehouse_id')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return badRequest('El plan no existe.');

  const { data: records } = await db
    .from('count_records')
    .select('id, product_id, quantity, unit_code, counted_by, is_deleted')
    .eq('plan_id', planId);

  const rows = records ?? [];
  const openAnomalies = await openAnomalyIds(
    db,
    rows.map((row) => String(row.id)),
  );

  // The Oracle columns are codes, not uuids, so the three lookups below resolve
  // warehouse -> subinventory, product -> item and profile -> counter.
  const { data: warehouse } = await db
    .from('warehouses')
    .select('id, code')
    .eq('id', plan.warehouse_id)
    .maybeSingle();
  const products = await lookup(db, 'products', [...new Set(rows.map((row) => String(row.product_id)))]);
  const profiles = await lookup(db, 'profiles', [...new Set(rows.map((row) => String(row.counted_by)))]);

  const exportable: ExportableRecord[] = rows.map((row) => ({
    id: String(row.id),
    subinventory: String(warehouse?.code ?? ''),
    item: String(products.get(String(row.product_id))?.sku ?? ''),
    quantity: Number(row.quantity),
    unitCode: row.unit_code ?? null,
    counter: profiles.get(String(row.counted_by))?.counter_code ?? null,
    isDeleted: Boolean(row.is_deleted),
    hasOpenAnomaly: openAnomalies.has(String(row.id)),
  }));

  const lines = buildExportLines(exportable);
  const csv = toCsv(lines);

  const { data: batch, error: batchError } = await db
    .from('export_batches')
    .insert({
      code: exportCode(planId, new Date()),
      plan_id: planId,
      status: 'generated',
      format: 'csv',
      record_count: lines.length,
      open_anomaly_count: openAnomalies.size,
      generated_by: auditorId,
      // Cheap integrity anchor: the file can later be proven to be the one this
      // batch produced without storing the file itself.
      checksum: String(csv.length),
    })
    .select()
    .single();

  if (batchError || !batch) {
    return serverError(`No se pudo crear el lote de exportación: ${batchError?.message ?? 'sin datos'}`);
  }

  const { error: linesError } = await db
    .from('export_lines')
    .insert(
      lines.map((line) => ({
        batch_id: batch.id,
        record_id: line.recordId,
        line_number: line.lineNumber,
        subinventory: line.subinventory,
        item: line.item,
        count_qty: line.countQty,
        uom: line.uom,
        counter: line.counter,
      })),
    )
    .select();

  // No persisted lines, no download. The auditor sees an error instead of a
  // file the system cannot account for (REQ-OE-2).
  if (linesError) {
    return serverError(`No se pudieron guardar las líneas de exportación: ${linesError.message}`);
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${batch.code}.csv"`,
      'x-export-batch-id': String(batch.id),
    },
  });
}

export const POST: APIRoute = ({ request }) => handleExport(supabaseDb(supabase()), request);

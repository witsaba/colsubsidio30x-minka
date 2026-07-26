/**
 * Oracle export (REQ-OE-1, REQ-OE-2, RF-30/31, design D8).
 *
 * The export is the only artefact that leaves this system, and the invariant
 * that matters is that the FILE and the PERSISTED BATCH are the same thing. A
 * downloaded CSV with no `export_batches` row behind it is unreconcilable: the
 * warehouse would have loaded numbers into Oracle that this system has no
 * record of ever having produced. Hence "no download without a persisted batch".
 */
import { describe, expect, it } from 'vitest';

import {
  buildExportLines,
  toCsv,
  EXPORT_COLUMNS,
  type ExportableRecord,
} from '../../src/lib/server/export';
import { handleExport, prerender } from '../../src/pages/api/export';
import { createStubDb } from './stub-db';

function record(overrides: Partial<ExportableRecord> = {}): ExportableRecord {
  return {
    id: 'rec-1',
    subinventory: 'BOD-A',
    item: 'SKU-1',
    quantity: 20,
    unitCode: 'KG',
    counter: 'CNT-01',
    isDeleted: false,
    hasOpenAnomaly: false,
    ...overrides,
  };
}

describe('buildExportLines', () => {
  it('emits one line per eligible record, numbered from 1', () => {
    const lines = buildExportLines([
      record({ id: 'rec-1', item: 'SKU-1' }),
      record({ id: 'rec-2', item: 'SKU-2', quantity: 5 }),
    ]);

    expect(lines).toEqual([
      { lineNumber: 1, recordId: 'rec-1', subinventory: 'BOD-A', item: 'SKU-1', countQty: 20, uom: 'KG', counter: 'CNT-01' },
      { lineNumber: 2, recordId: 'rec-2', subinventory: 'BOD-A', item: 'SKU-2', countQty: 5, uom: 'KG', counter: 'CNT-01' },
    ]);
  });

  it('excludes soft-deleted records (RF-30)', () => {
    const lines = buildExportLines([record({ id: 'rec-1', isDeleted: true }), record({ id: 'rec-2' })]);

    expect(lines.map((line) => line.recordId)).toEqual(['rec-2']);
  });

  it('excludes records carrying an unresolved anomaly', () => {
    const lines = buildExportLines([
      record({ id: 'rec-1', hasOpenAnomaly: true }),
      record({ id: 'rec-2' }),
    ]);

    expect(lines.map((line) => line.recordId)).toEqual(['rec-2']);
  });

  it('renumbers contiguously after exclusions — Oracle rejects gaps in the sequence', () => {
    const lines = buildExportLines([
      record({ id: 'rec-1', isDeleted: true }),
      record({ id: 'rec-2' }),
      record({ id: 'rec-3', hasOpenAnomaly: true }),
      record({ id: 'rec-4' }),
    ]);

    expect(lines.map((line) => line.lineNumber)).toEqual([1, 2]);
  });

  it('produces no lines at all when everything is excluded', () => {
    const lines = buildExportLines([record({ isDeleted: true })]);

    expect(lines).toEqual([]);
  });
});

describe('toCsv', () => {
  it('writes the Oracle Import Count Sequences columns in order', () => {
    expect(EXPORT_COLUMNS).toEqual(['subinventory', 'item', 'count_qty', 'uom', 'counter']);

    const csv = toCsv(buildExportLines([record()]));

    const [header, first] = csv.trim().split('\n');
    expect(header).toBe('subinventory,item,count_qty,uom,counter');
    expect(first).toBe('BOD-A,SKU-1,20,KG,CNT-01');
  });

  it('quotes a field containing a comma so the column count survives', () => {
    const csv = toCsv(buildExportLines([record({ item: 'SKU,1' })]));

    expect(csv.trim().split('\n')[1]).toBe('BOD-A,"SKU,1",20,KG,CNT-01');
  });
});

/* -------------------------------------------------------------------------- */

const AUDITOR = 'aud-1';

function exportDb(options: { errors?: Record<string, string> } = {}) {
  return createStubDb({
    errors: options.errors,
    tables: {
      audit_plans: [{ id: 'plan-1', status: 'active', warehouse_id: 'wh-1' }],
      warehouses: [{ id: 'wh-1', code: 'BOD-A' }],
      count_records: [
        {
          id: 'rec-1',
          plan_id: 'plan-1',
          product_id: 'prod-1',
          quantity: 20,
          unit_code: 'KG',
          counted_by: 'op-1',
          is_deleted: false,
        },
        {
          id: 'rec-2',
          plan_id: 'plan-1',
          product_id: 'prod-2',
          quantity: 4,
          unit_code: 'KG',
          counted_by: 'op-1',
          is_deleted: true,
        },
      ],
      products: [
        { id: 'prod-1', sku: 'SKU-1' },
        { id: 'prod-2', sku: 'SKU-2' },
      ],
      profiles: [{ id: 'op-1', counter_code: 'CNT-01' }],
      record_anomalies: [],
    },
  });
}

function request(body: unknown = { planId: 'plan-1', auditorId: AUDITOR }): Request {
  return new Request('http://localhost:4321/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/export', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('persists a batch and its lines, then answers with the CSV attachment', async () => {
    const db = exportDb();

    const response = await handleExport(db, request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(db.rows('export_batches')).toHaveLength(1);
    expect(db.rows('export_batches')[0]).toMatchObject({
      plan_id: 'plan-1',
      record_count: 1,
      open_anomaly_count: 0,
      generated_by: AUDITOR,
      format: 'csv',
    });
    expect(db.rows('export_lines')).toHaveLength(1);
  });

  it('exposes the persisted batch id on the response, so the file is traceable', async () => {
    const db = exportDb();

    const response = await handleExport(db, request());

    expect(response.headers.get('x-export-batch-id')).toBe(db.rows('export_batches')[0]!.id);
  });

  it('emits a body matching the persisted lines 1:1 (REQ-OE-2)', async () => {
    const db = exportDb();

    const body = await (await handleExport(db, request())).text();

    const dataRows = body.trim().split('\n').slice(1);
    expect(dataRows).toHaveLength(db.rows('export_lines').length);
    expect(dataRows[0]).toBe('BOD-A,SKU-1,20,KG,CNT-01');
  });

  it('returns an error and NO csv body when the line insert fails', async () => {
    const db = exportDb({ errors: { 'insert:export_lines': 'insert failed' } });

    const response = await handleExport(db, request());

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).not.toContain('subinventory');
    expect(db.rows('export_lines')).toEqual([]);
  });

  it('returns an error and no csv when the batch insert fails', async () => {
    const db = exportDb({ errors: { 'insert:export_batches': 'insert failed' } });

    const response = await handleExport(db, request());

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(db.rows('export_lines')).toEqual([]);
  });

  it('rejects a request with no plan as 400 without writing a batch', async () => {
    const db = exportDb();

    const response = await handleExport(db, request({ auditorId: AUDITOR }));

    expect(response.status).toBe(400);
    expect(db.rows('export_batches')).toEqual([]);
  });
});

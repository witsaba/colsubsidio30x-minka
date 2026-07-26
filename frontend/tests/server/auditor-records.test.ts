/**
 * `GET /api/auditor/records` (REQ-AUD-3, REQ-AV-2).
 *
 * The auditor dashboard used to render eight hardcoded fixture rows. This route
 * replaces them with what the operators actually counted.
 *
 * Two rules: soft-deleted records never appear (they were corrected, and
 * showing them would double-count the shelf on screen), and each record carries
 * its anomalies so the badges are real rather than decorative. Unlike the
 * operator paths, the auditor MAY see figures — RF-18 binds the tablet only.
 */
import { describe, expect, it } from 'vitest';

import { handleAuditorRecords, prerender } from '../../src/pages/api/auditor/records';
import { createStubDb } from './stub-db';

function db() {
  return createStubDb({
    tables: {
      count_records: [
        {
          id: 'rec-1',
          plan_id: 'plan-1',
          product_id: 'prod-1',
          quantity: 90,
          unit_code: 'KG',
          counted_by: 'op-1',
          status: 'flagged',
          is_deleted: false,
          dictated_text: 'aceite girasol',
        },
        {
          id: 'rec-2',
          plan_id: 'plan-1',
          product_id: 'prod-2',
          quantity: 5,
          unit_code: 'KG',
          counted_by: 'op-1',
          status: 'confirmed',
          is_deleted: true,
          dictated_text: 'arroz',
        },
        {
          id: 'rec-3',
          plan_id: 'plan-1',
          product_id: 'prod-3',
          quantity: 12,
          unit_code: 'UND',
          counted_by: 'op-1',
          status: 'confirmed',
          is_deleted: false,
          dictated_text: 'gaseosas',
        },
      ],
      record_anomalies: [
        {
          id: 'an-1',
          record_id: 'rec-1',
          type: 'atypical_quantity',
          severity: 'warning',
          title: 'Cantidad fuera de lo habitual',
          status: 'open',
        },
      ],
      products: [
        { id: 'prod-1', sku: 'SKU-1', name: 'ACEITE GIRASOL 900' },
        { id: 'prod-3', sku: 'SKU-3', name: 'GASEOSA 350ML' },
      ],
    },
  });
}

async function records(query = '?plan=plan-1') {
  const response = await handleAuditorRecords(db(), new Request(`http://localhost:4321/api/auditor/records${query}`));
  return (await response.json()) as Array<{ id: string; anomalies: unknown[]; quantity: number }>;
}

describe('GET /api/auditor/records', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('excludes soft-deleted records (RF-21/RF-30)', async () => {
    const rows = await records();

    expect(rows.map((row) => row.id)).toEqual(['rec-1', 'rec-3']);
  });

  it('attaches the anomalies of each record for the badges', async () => {
    const rows = await records();

    expect(rows[0]).toMatchObject({
      id: 'rec-1',
      quantity: 90,
      articulo: 'ACEITE GIRASOL 900',
      anomalies: [{ type: 'atypical_quantity', severity: 'warning', status: 'open' }],
    });
  });

  it('gives a clean record an empty anomaly list rather than omitting the field', async () => {
    const rows = await records();

    expect(rows[1]).toMatchObject({ id: 'rec-3', anomalies: [] });
  });

  it('rejects a request with no plan as 400 without reading records', async () => {
    const stub = db();

    const response = await handleAuditorRecords(stub, new Request('http://localhost:4321/api/auditor/records'));

    expect(response.status).toBe(400);
    expect(stub.calls).toEqual([]);
  });
});

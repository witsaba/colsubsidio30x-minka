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
          warehouse_id: 'wh-1',
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
          warehouse_id: 'wh-1',
          product_id: 'prod-2',
          quantity: 5,
          unit_code: 'KG',
          counted_by: 'op-1',
          status: 'recorded',
          is_deleted: true,
          dictated_text: 'arroz',
        },
        {
          id: 'rec-3',
          plan_id: 'plan-1',
          warehouse_id: 'wh-1',
          product_id: 'prod-3',
          quantity: 12,
          unit_code: 'UND',
          counted_by: 'op-1',
          status: 'recorded',
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
      // Task 6.6: the theoretical stock the auditor compares against. `prod-3`
      // deliberately has NO row — a real absence, which must read as null.
      warehouse_stock_balances: [
        { id: 'bal-1', warehouse_id: 'wh-1', product_id: 'prod-1', unit_code: 'KG', theoretical_qty: 120 },
        // Same product in ANOTHER warehouse: must never be used for `rec-1`.
        { id: 'bal-2', warehouse_id: 'wh-9', product_id: 'prod-1', unit_code: 'UND', theoretical_qty: 7 },
      ],
      // Task 6.7: the persisted trail, seeded OUT of chronological order so the
      // ordering assertion cannot pass by accident.
      auditor_actions: [
        {
          id: 'act-2',
          record_id: 'rec-1',
          actor_id: 'aud-1',
          action: 'approve',
          reason: null,
          created_at: '2026-07-25T15:40:00Z',
        },
        {
          id: 'act-1',
          record_id: 'rec-1',
          actor_id: 'aud-1',
          action: 'correct',
          reason: 'La báscula marcaba 89.',
          created_at: '2026-07-25T14:05:00Z',
        },
      ],
      profiles: [{ id: 'aud-1', full_name: 'Ana Auditora' }],
    },
  });
}

interface RecordPayload {
  id: string;
  quantity: number;
  anomalies: unknown[];
  systemQty: number | null;
  systemUnitCode: string | null;
  actions: Array<{ action: string; note: string | null; auditor: string | null; createdAt: string }>;
}

async function records(query = '?plan=plan-1') {
  const response = await handleAuditorRecords(db(), new Request(`http://localhost:4321/api/auditor/records${query}`));
  return (await response.json()) as RecordPayload[];
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

  it('joins the theoretical stock of the record own warehouse (REQ-AUD-2, task 6.6)', async () => {
    const rows = await records();

    // 120 is the `wh-1` balance; 7 is the same product in `wh-9` and must lose.
    expect(rows[0]).toMatchObject({ id: 'rec-1', systemQty: 120, systemUnitCode: 'KG' });
  });

  it('reports a missing balance row as null rather than as a zero stock', async () => {
    const rows = await records();

    expect(rows[1]).toMatchObject({ id: 'rec-3', systemQty: null, systemUnitCode: null });
  });

  it('reads back the persisted auditor_actions, oldest first, with the signing name (RF-32, task 6.7)', async () => {
    const rows = await records();

    expect(rows[0]!.actions).toEqual([
      {
        action: 'correct',
        note: 'La báscula marcaba 89.',
        auditor: 'Ana Auditora',
        createdAt: '2026-07-25T14:05:00Z',
      },
      {
        action: 'approve',
        note: null,
        auditor: 'Ana Auditora',
        createdAt: '2026-07-25T15:40:00Z',
      },
    ]);
  });

  it('gives an untouched record an empty action list rather than omitting the field', async () => {
    const rows = await records();

    expect(rows[1]).toMatchObject({ id: 'rec-3', actions: [] });
  });

  it('rejects a request with no plan as 400 without reading records', async () => {
    const stub = db();

    const response = await handleAuditorRecords(stub, new Request('http://localhost:4321/api/auditor/records'));

    expect(response.status).toBe(400);
    expect(stub.calls).toEqual([]);
  });
});

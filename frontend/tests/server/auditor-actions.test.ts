/**
 * `POST /api/auditor/actions` (REQ-AUD-4, RF-32, design D7).
 *
 * `auditor_actions` is the audit trail. It is APPEND-ONLY: correcting a
 * quantity twice must leave two rows, not one row rewritten, because the
 * question the trail answers is "what did the auditor do, and when" — a
 * mutated row answers only "what do they say now".
 */
import { describe, expect, it } from 'vitest';

import { handleAuditorAction, prerender } from '../../src/pages/api/auditor/actions';
import { handleExport } from '../../src/pages/api/export';
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
          is_deleted: false,
          status: 'flagged',
        },
      ],
      auditor_actions: [],
      record_anomalies: [{ id: 'an-1', record_id: 'rec-1', status: 'open' }],
    },
  });
}

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost:4321/api/auditor/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ auditorId: 'aud-1', recordId: 'rec-1', ...body }),
  });
}

describe('POST /api/auditor/actions', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('appends an approve action carrying the unchanged figures', async () => {
    const stub = db();

    const response = await handleAuditorAction(stub, request({ action: 'approve' }));

    expect(response.status).toBe(201);
    expect(stub.rows('auditor_actions')).toHaveLength(1);
    expect(stub.rows('auditor_actions')[0]).toMatchObject({
      record_id: 'rec-1',
      actor_id: 'aud-1',
      action: 'approve',
      previous_quantity: 90,
      new_quantity: 90,
      previous_unit_code: 'KG',
      new_unit_code: 'KG',
    });
  });

  it('records both sides of a correction', async () => {
    const stub = db();

    await handleAuditorAction(
      stub,
      request({ action: 'correct', newQuantity: 12, newUnitCode: 'UND', note: 'recontado' }),
    );

    expect(stub.rows('auditor_actions')[0]).toMatchObject({
      action: 'correct',
      previous_quantity: 90,
      new_quantity: 12,
      previous_unit_code: 'KG',
      new_unit_code: 'UND',
      reason: 'recontado',
    });
  });

  it('never updates an existing action row — two corrections leave two rows', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'correct', newQuantity: 12 }));
    await handleAuditorAction(stub, request({ action: 'correct', newQuantity: 15 }));

    expect(stub.rows('auditor_actions')).toHaveLength(2);
    expect(stub.calls.filter((call) => call.table === 'auditor_actions' && call.op === 'update')).toEqual([]);
  });

  it('opens a recount request alongside the action when a recount is asked for', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'request_recount', note: 'volver a contar' }));

    expect(stub.rows('auditor_actions')[0]).toMatchObject({ action: 'request_recount' });
    expect(stub.rows('recount_requests')).toHaveLength(1);
    expect(stub.rows('recount_requests')[0]).toMatchObject({
      record_id: 'rec-1',
      requested_by: 'aud-1',
      // Live `recount_status` enum is requested|in_progress|done|cancelled —
      // 'open' (the shape `record_anomalies` uses) is NOT a member here.
      status: 'requested',
      // The column on THIS table is `note`; on `auditor_actions` it is `reason`.
      // They are genuinely different columns, not a naming convention.
      note: 'volver a contar',
      // Both NOT NULL, and both sourced from the already-fetched count record
      // rather than from a second query or the client's word for it.
      plan_id: 'plan-1',
      product_id: 'prod-1',
    });
  });

  it('opens no recount request for an approval', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'approve' }));

    expect(stub.rows('recount_requests')).toEqual([]);
  });

  it('rejects an unknown action verb as 400 without writing', async () => {
    const stub = db();

    const response = await handleAuditorAction(stub, request({ action: 'delete_everything' }));

    expect(response.status).toBe(400);
    expect(stub.rows('auditor_actions')).toEqual([]);
  });

  it('answers 404 for a record that does not exist', async () => {
    const stub = db();

    const response = await handleAuditorAction(
      stub,
      request({ action: 'approve', recordId: 'ghost' }),
    );

    expect(response.status).toBe(404);
    expect(stub.rows('auditor_actions')).toEqual([]);
  });

  it('answers 5xx when the append fails, so the client shows no trace entry', async () => {
    const stub = createStubDb({
      errors: { 'insert:auditor_actions': 'permission denied' },
      tables: { count_records: [{ id: 'rec-1', plan_id: 'plan-1', quantity: 90, unit_code: 'KG' }] },
    });

    const response = await handleAuditorAction(stub, request({ action: 'approve' }));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(stub.rows('auditor_actions')).toEqual([]);
  });
});

/**
 * The approval WRITER (task 6.14).
 *
 * The append-only trail above answers "what did the auditor do". It does not
 * answer "is this count settled", and until this route also moves the record's
 * own state, nothing in the system ever does: `count_records.status` never
 * reached `'verified'` and an open `record_anomalies` row stayed open forever.
 * That is not a cosmetic gap — `POST /api/export` excludes any record with an
 * open anomaly, so an approved-on-screen record was dropped from every future
 * export, silently and permanently.
 */
describe('POST /api/auditor/actions — settling the record', () => {
  it('resolves the open anomaly when the auditor approves', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'approve', note: 'verificado en piso' }));

    const anomaly = stub.rows('record_anomalies')[0]!;
    expect(anomaly.status).toBe('resolved');
    expect(anomaly.resolved_by).toBe('aud-1');
    expect(anomaly.resolution_note).toBe('verificado en piso');
    expect(typeof anomaly.resolved_at).toBe('string');
  });

  it('marks the record verified when the auditor approves', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'approve' }));

    expect(stub.rows('count_records')[0]!.status).toBe('verified');
  });

  it('settles the record on a correction too — the figure is now the auditor’s', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'correct', newQuantity: 12 }));

    expect(stub.rows('record_anomalies')[0]!.status).toBe('resolved');
    expect(stub.rows('count_records')[0]!.status).toBe('verified');
  });

  it('leaves the anomaly OPEN on a rejection — a bad count must not become exportable', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'reject', note: 'no coincide' }));

    expect(stub.rows('record_anomalies')[0]!.status).toBe('open');
    expect(stub.rows('count_records')[0]!.status).toBe('flagged');
  });

  it('leaves the anomaly OPEN when a recount is requested — the count is not settled yet', async () => {
    const stub = db();

    await handleAuditorAction(stub, request({ action: 'request_recount', note: 'volver a contar' }));

    expect(stub.rows('record_anomalies')[0]!.status).toBe('open');
    expect(stub.rows('count_records')[0]!.status).toBe('flagged');
  });

  it('makes a previously export-blocked record reach Oracle once approved', async () => {
    const stub = createStubDb({
      tables: {
        audit_plans: [{ id: 'plan-1', warehouse_id: 'wh-1' }],
        warehouses: [{ id: 'wh-1', code: 'BOD-01' }],
        products: [{ id: 'prod-1', sku: 'SKU-1' }],
        profiles: [{ id: 'op-1', counter_code: 'CNT-01' }],
        count_records: [
          {
            id: 'rec-1',
            plan_id: 'plan-1',
            product_id: 'prod-1',
            counted_by: 'op-1',
            quantity: 90,
            unit_code: 'KG',
            is_deleted: false,
            status: 'flagged',
          },
        ],
        record_anomalies: [{ id: 'an-1', record_id: 'rec-1', status: 'open' }],
      },
    });
    const exportRequest = () =>
      new Request('http://localhost:4321/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId: 'plan-1', auditorId: 'aud-1' }),
      });

    const before = await (await handleExport(stub, exportRequest())).text();
    expect(before.trim().split('\n').slice(1)).toEqual([]);

    await handleAuditorAction(stub, request({ action: 'approve' }));
    const after = await (await handleExport(stub, exportRequest())).text();

    expect(after.trim().split('\n').slice(1)).toEqual(['BOD-01,SKU-1,90,KG,CNT-01']);
  });
});

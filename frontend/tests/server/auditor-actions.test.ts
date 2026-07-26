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
import { createStubDb } from './stub-db';

function db() {
  return createStubDb({
    tables: {
      count_records: [
        { id: 'rec-1', plan_id: 'plan-1', quantity: 90, unit_code: 'KG', is_deleted: false },
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
      auditor_id: 'aud-1',
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
      note: 'recontado',
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
      status: 'open',
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

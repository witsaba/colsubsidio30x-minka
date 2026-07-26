/**
 * `DELETE /api/records/[id]` — delete-and-redo (REQ-SDA-4, RF-20/21, design D6).
 *
 * "Delete" is a TOUCH-ONLY correction gesture, never a destruction: voice
 * creates records and never edits them, so a correction is a soft-deleted
 * original plus a brand-new dictation. The original must survive for the audit
 * trail, which is why the guard below asserts `.delete()` is never issued.
 */
import { describe, expect, it } from 'vitest';

import { handleDeleteRecord, prerender } from '../../src/pages/api/records/[id]';
import { createStubDb } from './stub-db';

function request(body: unknown = { operatorId: 'op-1', reason: 'conteo equivocado' }): Request {
  return new Request('http://localhost:4321/api/records/rec-1', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function db(options: { assigned?: boolean } = {}) {
  const { assigned = true } = options;
  return createStubDb({
    tables: {
      audit_plans: [{ id: 'plan-1', status: 'active', warehouse_id: 'wh-1' }],
      warehouses: [{ id: 'wh-1', code: 'STOCK_RESTAURANTE_FUENTES_AYB' }],
      plan_operators: assigned ? [{ plan_id: 'plan-1', profile_id: 'op-1' }] : [],
      count_records: [
        { id: 'rec-1', plan_id: 'plan-1', quantity: 20, is_deleted: false },
        { id: 'rec-2', plan_id: 'plan-1', quantity: 5, is_deleted: false },
      ],
    },
  });
}

describe('DELETE /api/records/[id]', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('marks the row deleted instead of removing it', async () => {
    const stub = db();

    const response = await handleDeleteRecord(stub, 'rec-1', request());

    expect(response.status).toBe(200);
    expect(stub.rows('count_records')).toHaveLength(2);
    expect(stub.rows('count_records')[0]).toMatchObject({
      id: 'rec-1',
      is_deleted: true,
      deleted_by: 'op-1',
      delete_reason: 'conteo equivocado',
    });
    expect(stub.rows('count_records')[0]!.deleted_at).toEqual(expect.any(String));
  });

  it('never issues a hard delete (RF-21)', async () => {
    const stub = db();

    await handleDeleteRecord(stub, 'rec-1', request());

    expect(stub.callsOf('delete')).toEqual([]);
    expect(stub.callsOf('update')).toHaveLength(1);
  });

  it('leaves every other record untouched', async () => {
    const stub = db();

    await handleDeleteRecord(stub, 'rec-1', request());

    expect(stub.rows('count_records')[1]).toMatchObject({ id: 'rec-2', is_deleted: false });
  });

  it('preserves the original quantity — the row is evidence, not a draft', async () => {
    const stub = db();

    await handleDeleteRecord(stub, 'rec-1', request());

    expect(stub.rows('count_records')[0]!.quantity).toBe(20);
  });

  it('refuses an operator not assigned to the record plan with 403 and no write', async () => {
    const stub = db({ assigned: false });

    const response = await handleDeleteRecord(stub, 'rec-1', request());

    expect(response.status).toBe(403);
    expect(stub.rows('count_records')[0]!.is_deleted).toBe(false);
  });

  it('answers 404 for a record that does not exist', async () => {
    const stub = db();

    const response = await handleDeleteRecord(stub, 'ghost', request());

    expect(response.status).toBe(404);
    expect(stub.callsOf('update')).toEqual([]);
  });

  it('rejects a body with no operator as 400', async () => {
    const stub = db();

    const response = await handleDeleteRecord(stub, 'rec-1', request({ reason: 'x' }));

    expect(response.status).toBe(400);
    expect(stub.calls).toEqual([]);
  });
});

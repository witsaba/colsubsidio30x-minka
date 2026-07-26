/**
 * Browser client for the Supabase-backed routes (design "File Changes").
 *
 * It reuses `request<T>` from `client.ts` on purpose: the error taxonomy
 * (`UiError` + `request_id`) and the timeout composition are already solved
 * there, and a second fetch path would drift from the first (REQ-PRX-2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UiError } from '../../src/lib/api/types';
import {
  createRecord,
  deleteRecord,
  downloadExport,
  fetchAuditorRecords,
  fetchPlans,
  postAuditorAction,
  postConsent,
} from '../../src/lib/api/operational';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('operational API client', () => {
  it('posts consent and returns the persisted id', async () => {
    const calls = stubFetch({ id: 'consent-1' }, 201);

    await expect(postConsent({ operatorId: 'op-1', policyVersion: 'v1' })).resolves.toEqual({
      id: 'consent-1',
    });
    expect(calls[0]!.url).toBe('/api/consent');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ operatorId: 'op-1', policyVersion: 'v1' });
  });

  it('surfaces a failed consent write as a UiError, so S1 can block', async () => {
    stubFetch({ error: { code: 'vendor_error', message: 'nope' } }, 500);

    await expect(postConsent({ operatorId: 'op-1' })).rejects.toBeInstanceOf(UiError);
  });

  it('fetches the plans of one operator by query parameter', async () => {
    const calls = stubFetch([{ id: 'plan-1', name: 'Bodega A', warehouseId: 'wh-1', catalogueId: 'cat-1' }]);

    const plans = await fetchPlans('op-1');

    expect(plans).toHaveLength(1);
    expect(plans[0]!.name).toBe('Bodega A');
    expect(calls[0]!.url).toBe('/api/plans?operator=op-1');
  });

  it('url-encodes the operator identifier', async () => {
    const calls = stubFetch([]);

    await fetchPlans('op 1/2');

    expect(calls[0]!.url).toBe('/api/plans?operator=op%201%2F2');
  });

  it('posts a count record and returns the server id and verdict', async () => {
    const calls = stubFetch({ id: 'srv-1', verdict: 'ok', anomaly: null }, 201);

    const created = await createRecord({
      clientRecordId: 'client-1',
      planId: 'plan-1',
      operatorId: 'op-1',
      productId: 'prod-1',
      quantity: 20,
      unitCode: 'KG',
      spokenName: 'aceite',
    });

    expect(created).toEqual({ id: 'srv-1', verdict: 'ok', anomaly: null });
    expect(calls[0]!.url).toBe('/api/records');
  });

  it('deletes a record by id with the operator and reason in the body', async () => {
    const calls = stubFetch({ id: 'srv-1', deleted: true });

    await deleteRecord('srv-1', { operatorId: 'op-1', reason: 'mal conteo' });

    expect(calls[0]!.url).toBe('/api/records/srv-1');
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ operatorId: 'op-1', reason: 'mal conteo' });
  });

  it('fetches the auditor feed for one plan', async () => {
    const calls = stubFetch([{ id: 'rec-1', anomalies: [] }]);

    const records = await fetchAuditorRecords('plan-1');

    expect(records).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/auditor/records?plan=plan-1');
  });

  it('posts an auditor action', async () => {
    const calls = stubFetch({ id: 'act-1', action: 'approve' }, 201);

    await postAuditorAction({ auditorId: 'aud-1', recordId: 'rec-1', action: 'approve' });

    expect(calls[0]!.url).toBe('/api/auditor/actions');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ action: 'approve' });
  });

  it('rejects an auditor action the server refused, so no trace entry is drawn', async () => {
    stubFetch({ error: { code: 'vendor_error', message: 'nope' } }, 500);

    await expect(
      postAuditorAction({ auditorId: 'aud-1', recordId: 'rec-1', action: 'approve' }),
    ).rejects.toBeInstanceOf(UiError);
  });
});

/* -------------------------------------------------------------------------- */
/* Oracle export download (REQ-OE-2, task 5.10)                               */
/* -------------------------------------------------------------------------- */

const CSV = 'subinventory,item,count_qty,uom,counter\nSTOCK_X,MP-1,3,und,OP.001\n';

/** `POST /api/export` answers `text/csv`, not JSON — its own transport path. */
function stubCsvFetch(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, {
        status,
        headers: { 'content-type': 'text/csv; charset=utf-8', ...headers },
      });
    }),
  );
  return calls;
}

describe('downloadExport', () => {
  it('posts the plan and auditor and returns the CSV with its batch id and filename', async () => {
    const calls = stubCsvFetch(CSV, 200, {
      'content-disposition': 'attachment; filename="EXP-plan-1-20260725.csv"',
      'x-export-batch-id': 'batch-9',
    });

    const download = await downloadExport({ planId: 'plan-1', auditorId: 'aud-1' });

    expect(download).toEqual({
      csv: CSV,
      batchId: 'batch-9',
      filename: 'EXP-plan-1-20260725.csv',
    });
    expect(calls[0]!.url).toBe('/api/export');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ planId: 'plan-1', auditorId: 'aud-1' });
  });

  it('falls back to a plan-derived filename when the server names none', async () => {
    stubCsvFetch(CSV, 200, { 'x-export-batch-id': 'batch-9' });

    const download = await downloadExport({ planId: 'plan-1', auditorId: 'aud-1' });

    expect(download.filename).toBe('export-plan-1.csv');
    expect(download.batchId).toBe('batch-9');
  });

  it('rejects with a UiError when the batch could not be persisted — no file', async () => {
    stubCsvFetch(JSON.stringify({ error: { code: 'vendor_error', message: 'no batch' } }), 500);

    await expect(downloadExport({ planId: 'plan-1', auditorId: 'aud-1' })).rejects.toBeInstanceOf(
      UiError,
    );
  });

  it('rejects an empty body: a CSV with no lines is not a file the auditor may keep', async () => {
    stubCsvFetch('', 200, { 'x-export-batch-id': 'batch-9' });

    await expect(downloadExport({ planId: 'plan-1', auditorId: 'aud-1' })).rejects.toBeInstanceOf(
      UiError,
    );
  });
});

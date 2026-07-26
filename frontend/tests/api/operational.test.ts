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

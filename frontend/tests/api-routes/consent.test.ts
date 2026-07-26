/**
 * `POST /api/consent` (REQ-SDA-2, RNF-04 / ISO 27001).
 *
 * S1 consent is legally significant: the operator's acceptance of voice capture
 * must EXIST in `voice_consents` before any dictation happens. A failed write
 * that still let the flow advance would mean counting with no record of
 * consent, which is exactly the situation the table was created to prevent —
 * hence the "5xx, not 2xx" assertion.
 */
import { describe, expect, it } from 'vitest';

import { handleConsent, prerender } from '../../src/pages/api/consent';
import { createStubDb } from '../server/stub-db';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:4321/api/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = { operatorId: 'op-1', policyVersion: 'v1' };

describe('POST /api/consent', () => {
  it('is server-rendered', () => {
    expect(prerender).toBe(false);
  });

  it('inserts a granted consent row for the operator', async () => {
    const db = createStubDb();

    const response = await handleConsent(db, request(validBody, { 'user-agent': 'Pixel/7' }));

    expect(response.status).toBe(201);
    expect(db.rows('voice_consents')).toHaveLength(1);
    expect(db.rows('voice_consents')[0]).toMatchObject({
      profile_id: 'op-1',
      status: 'granted',
      policy_version: 'v1',
      user_agent: 'Pixel/7',
    });
  });

  it('returns the persisted consent id so the client can prove the write happened', async () => {
    const db = createStubDb();

    const body = (await (await handleConsent(db, request(validBody))).json()) as { id: string };

    expect(body.id).toBe(db.rows('voice_consents')[0]!.id);
  });

  it('answers 5xx and persists nothing when the insert fails', async () => {
    const db = createStubDb({ errors: { 'insert:voice_consents': 'permission denied' } });

    const response = await handleConsent(db, request(validBody));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(db.rows('voice_consents')).toEqual([]);
  });

  it('rejects a body with no operator as a 400 without writing', async () => {
    const db = createStubDb();

    const response = await handleConsent(db, request({ policyVersion: 'v1' }));

    expect(response.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it('records a null user agent rather than inventing one', async () => {
    const db = createStubDb();

    await handleConsent(db, request(validBody));

    expect(db.rows('voice_consents')[0]!.user_agent).toBeNull();
  });
});

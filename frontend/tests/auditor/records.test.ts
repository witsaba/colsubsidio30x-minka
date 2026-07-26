/**
 * Task 5.5/5.6 RED — `AuditorRecordDto` -> `AuditorRecord` (REQ-AUD-3).
 *
 * The dashboard renders a DISPLAY shape (pre-formatted es-CO quantities, one
 * badge-bearing alert, a signed trace). `GET /api/auditor/records` answers with
 * the STORAGE shape (numbers, a list of `record_anomalies`). This pure function
 * is the whole translation, so it is tested here without rendering anything —
 * the island then only has to fetch and hand the result over.
 */
import { describe, expect, it } from 'vitest';

import type { AuditorRecordDto } from '../../src/lib/api/operational';
import { SYSTEM_UNKNOWN, diffOf } from '../../src/lib/auditor/types';
import { toAuditorRecords } from '../../src/lib/auditor/records';

const dto = (over: Partial<AuditorRecordDto> = {}): AuditorRecordDto => ({
  id: 'rec-1',
  quantity: 3,
  unitCode: 'und',
  articulo: 'ARROZ BLANCO 500G',
  nrArticulo: 'MP-1',
  spokenName: 'tres unidades de arroz',
  status: 'recorded',
  countedBy: 'OP.001',
  anomalies: [],
  systemQty: null,
  systemUnitCode: null,
  actions: [],
  ...over,
});

describe('toAuditorRecords', () => {
  it('maps a clean record into the display shape with an empty trace', () => {
    const [record] = toAuditorRecords([dto()], 'PLAN-DEMO-001');

    expect(record).toMatchObject({
      id: 'rec-1',
      counted: { quantity: '3', unit: 'und' },
      articulo: 'ARROZ BLANCO 500G',
      sku: 'MP-1',
      operator: 'OP.001',
      plan: 'PLAN-DEMO-001',
      dictated: 'tres unidades de arroz',
      alert: null,
      verified: false,
      manualSearch: false,
    });
    // A trace entry may only come from a persisted `auditor_actions` row.
    expect(record!.trace).toEqual([]);
  });

  it('renders decimal quantities in es-CO, with a comma', () => {
    const [record] = toAuditorRecords([dto({ quantity: 6.5 })], 'p');
    expect(record!.counted.quantity).toBe('6,5');
  });

  it('never invents a theoretical stock the route does not send', () => {
    const [record] = toAuditorRecords([dto()], 'p');

    expect(record!.system.quantity).toBe(SYSTEM_UNKNOWN);
    // And the detail pane says so, instead of claiming a difference of NaN.
    expect(diffOf(record!)).toEqual({ label: 'Sistema sin dato', tone: 'neutral' });
  });

  it('renders the theoretical stock the route now sends, and diffs against it (task 6.6)', () => {
    const [record] = toAuditorRecords(
      [dto({ quantity: 3, unitCode: 'und', systemQty: 6.5, systemUnitCode: 'und' })],
      'p',
    );

    expect(record!.system).toEqual({ quantity: '6,5', unit: 'und' });
    expect(diffOf(record!)).toEqual({ label: 'Diferencia', tone: 'warn' });
  });

  it('says "Sin diferencia" when the count matches the system figure', () => {
    const [record] = toAuditorRecords(
      [dto({ quantity: 6.5, unitCode: 'und', systemQty: 6.5, systemUnitCode: 'und' })],
      'p',
    );

    expect(diffOf(record!)).toEqual({ label: 'Sin diferencia', tone: 'ok' });
  });

  it('seeds the trace from the persisted actions, newest first (RF-32, task 6.7)', () => {
    const [record] = toAuditorRecords(
      [
        dto({
          actions: [
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
          ],
        }),
      ],
      'p',
    );

    expect(record!.trace.map((entry) => entry.action)).toEqual([
      'Aprobó el registro',
      'Corrigió la cantidad',
    ]);
    expect(record!.trace[1]).toMatchObject({
      user: 'Ana Auditora',
      reason: 'La báscula marcaba 89.',
    });
    // 14:05 UTC is 9:05 in Bogotá — the trail is read in the operation's zone.
    expect(record!.trace[1]!.time).toContain('9:05');
    // Approving needs no justification, so it carries no reason at all.
    expect(record!.trace[0]!.reason).toBeUndefined();
  });

  it('falls back to the unknown marker when an action has no signing name', () => {
    const [record] = toAuditorRecords(
      [
        dto({
          actions: [
            { action: 'request_recount', note: null, auditor: null, createdAt: '2026-07-25T14:05:00Z' },
          ],
        }),
      ],
      'p',
    );

    expect(record!.trace[0]).toMatchObject({ action: 'Pidió reconteo', user: SYSTEM_UNKNOWN });
  });

  it('turns each open anomaly type into its badge kind', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['unit_mismatch', 'unidad'],
      ['atypical_quantity', 'cantidad'],
      ['negative_balance', 'negativo'],
    ];

    for (const [type, kind] of cases) {
      const [record] = toAuditorRecords(
        [dto({ anomalies: [{ type, severity: 'warning', title: 'Cantidad', status: 'open' }] })],
        'p',
      );
      expect(record!.alert?.kind).toBe(kind);
      expect(record!.alert?.title).toBe('Cantidad');
    }
  });

  it('ignores anomalies that are no longer open — they need no more eyes', () => {
    const [record] = toAuditorRecords(
      [
        dto({
          anomalies: [
            { type: 'atypical_quantity', severity: 'warning', title: 'Vieja', status: 'resolved' },
          ],
        }),
      ],
      'p',
    );

    expect(record!.alert).toBeNull();
  });

  it('marks a verified record as verified, so it leaves the pending filter', () => {
    const [record] = toAuditorRecords([dto({ status: 'verified' })], 'p');
    expect(record!.verified).toBe(true);
  });

  it('survives a record with no product code, unit or counter', () => {
    const [record] = toAuditorRecords(
      [dto({ nrArticulo: null, unitCode: null, countedBy: null })],
      'p',
    );

    expect(record!.sku).toBe('');
    expect(record!.counted.unit).toBe('');
    expect(record!.operator).toBe(SYSTEM_UNKNOWN);
  });

  it('maps every record it is given, preserving order', () => {
    const records = toAuditorRecords(
      [dto({ id: 'a' }), dto({ id: 'b' }), dto({ id: 'c' })],
      'p',
    );
    expect(records.map((record) => record.id)).toEqual(['a', 'b', 'c']);
  });
});

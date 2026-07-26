/**
 * Session resume plumbing (REQ-OCF-13, task 6.11) — the two pure halves.
 *
 * `CountSession` cannot restore anything it cannot re-find after a reload: the
 * records live in Supabase, but WHICH plan was being counted lives only in the
 * reducer, which a reload destroys. These two functions are that memory and the
 * translation back into the reducer's own record shape, kept pure so the
 * component test does not have to reason about storage.
 *
 * What is stored is deliberately only the plan SCOPE — four ids the browser was
 * already given by `GET /api/plans`. No count, no quantity, and above all no
 * theoretical stock: RF-18 blindness cannot be laundered through storage.
 */
import { describe, expect, it } from 'vitest';

import {
  RESUME_STORAGE_KEY,
  readResumeContext,
  toCountRecord,
  writeResumeContext,
} from '../../src/lib/session/resume';
import type { RestoredRecordDto } from '../../src/lib/api/operational';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

const context = {
  catalogueId: 'STOCK_RESTAURANTE_FUENTES_AYB',
  planId: 'plan-1',
  operatorId: 'op-1',
  warehouseId: 'wh-1',
};

function dto(over: Partial<RestoredRecordDto> = {}): RestoredRecordDto {
  return {
    id: 'rec-1000-0',
    serverId: 'srv-1',
    quantity: 20,
    unitCode: 'KG',
    unitDisplay: 'Kilogramo',
    articulo: 'ACEITE GIRASOL 900',
    nrArticulo: 'SKU-1',
    spokenName: 'veinte kilos de aceite',
    state: 'ok',
    anomaly: null,
    createdAt: '2026-07-25T13:00:00Z',
    ...over,
  };
}

describe('the resume context survives a reload', () => {
  it('reads back exactly what was written', () => {
    const storage = memoryStorage();

    writeResumeContext(context, storage);

    expect(readResumeContext(storage)).toEqual(context);
  });

  it('is absent before any plan has been started', () => {
    expect(readResumeContext(memoryStorage())).toBeNull();
  });

  it('is cleared when the count finishes, so the next session starts fresh', () => {
    const storage = memoryStorage();
    writeResumeContext(context, storage);

    writeResumeContext(null, storage);

    expect(readResumeContext(storage)).toBeNull();
  });

  it('refuses a partial context rather than resuming into a half-scoped session', () => {
    const storage = memoryStorage({
      [RESUME_STORAGE_KEY]: JSON.stringify({ planId: 'plan-1', operatorId: 'op-1' }),
    });

    expect(readResumeContext(storage)).toBeNull();
  });

  it('refuses corrupt storage instead of throwing on mount', () => {
    const storage = memoryStorage({ [RESUME_STORAGE_KEY]: 'not json at all' });

    expect(readResumeContext(storage)).toBeNull();
  });

  it('stores the plan scope and nothing else — no figures may reach storage', () => {
    const storage = memoryStorage();

    writeResumeContext(context, storage);

    expect(Object.keys(JSON.parse(storage.getItem(RESUME_STORAGE_KEY)!)).sort()).toEqual([
      'catalogueId',
      'operatorId',
      'planId',
      'warehouseId',
    ]);
  });
});

describe('a restored record becomes a settled CountRecord', () => {
  it('keeps the CLIENT id as the record id and the server uuid as serverId', () => {
    const record = toCountRecord(dto());

    expect(record.id).toBe('rec-1000-0');
    expect(record.serverId).toBe('srv-1');
  });

  it('carries the article, unit and spoken text the list renders', () => {
    expect(toCountRecord(dto())).toMatchObject({
      quantity: 20,
      unitCode: 'KG',
      unitDisplay: 'Kilogramo',
      articulo: 'ACEITE GIRASOL 900',
      nrArticulo: 'SKU-1',
      spokenName: 'veinte kilos de aceite',
      state: 'ok',
    });
  });

  it('never restores a record as sync, so nothing is written a second time', () => {
    expect(toCountRecord(dto({ state: 'anom_noted' })).state).toBe('anom_noted');
    expect(toCountRecord(dto()).state).not.toBe('sync');
  });

  it('rebuilds the anomaly copy from the static table, not from the server', () => {
    const record = toCountRecord(
      dto({
        state: 'anom_noted',
        anomaly: {
          type: 'atypical_quantity',
          severity: 'warning',
          title: 'Cantidad fuera de lo habitual',
        },
      }),
    );

    expect(record.anomaly).toEqual({
      kind: 'cantidad',
      title: 'Cantidad fuera de lo habitual',
      reason: 'La cantidad que dictaste está fuera de lo habitual para este artículo en esta bodega.',
      hint: 'Si de verdad es así, deja la nota y el auditor la revisa · RF-26(c)',
    });
  });

  it('carries no anomaly at all for a clean record', () => {
    expect(toCountRecord(dto()).anomaly).toBeUndefined();
  });

  it('turns the ISO timestamp into the epoch ms the list sorts and renders by', () => {
    expect(toCountRecord(dto()).createdAt).toBe(Date.parse('2026-07-25T13:00:00Z'));
  });
});

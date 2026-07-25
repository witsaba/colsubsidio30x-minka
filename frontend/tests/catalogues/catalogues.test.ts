/**
 * T12 — real matcher catalogues and the operator seed (REQ-OCF-8, D13).
 *
 * The 8 ids below are the REAL stock tables served by `GET /api/catalogues`.
 * If any of them drifts, the demo silently 404s on `match`, so they are pinned
 * literally here rather than derived from the module under test.
 */
import { describe, expect, it } from 'vitest';

import {
  CATALOGUES,
  CATALOGUE_IDS,
  DEMO_CATALOGUE_ID,
  RF11_LIMITATION_NOTE,
  isCatalogueId,
  labelFor,
} from '../../src/lib/catalogues';
import { OPERATOR_SEED_PROGRESS, OPERATOR_SEED_RECORDS } from '../../src/fixtures/operatorSeed';

/**
 * The matcher's real tables and their row counts.
 *
 * These are the counts the LIVE service reports, verified against
 * `GET http://localhost:8002/catalogues` on 2026-07-25 (total 1405).
 *
 * An earlier draft of this fixture carried each count one too high
 * (total 1413). That figure came from a stale design note and would have
 * printed "345 artículos" on the operator's plan card for a catalogue that
 * actually holds 344. The service is the source of truth, not the note.
 */
const REAL_CATALOGUES: Record<string, number> = {
  stock_almacen_ayb: 270,
  stock_almacen_suministros: 296,
  stock_kiosco_piscigiros_ayb: 56,
  stock_kiosco_taquilla_ayb: 58,
  stock_restaurante_fuentes_ayb: 344,
  stock_restaurante_fuentes_sumin: 133,
  zoologico: 55,
  zoologico_suministros: 193,
};

/** The matcher's own `/health` reports this total. */
const REAL_TOTAL_ROWS = 1405;

describe('REQ-OCF-8 — the 8 real catalogues', () => {
  it('exports exactly the 8 real catalogue ids, no more and no fewer', () => {
    expect([...CATALOGUE_IDS].sort()).toEqual(Object.keys(REAL_CATALOGUES).sort());
  });

  it('carries the real row count for every catalogue', () => {
    const rows = Object.fromEntries(CATALOGUES.map((c) => [c.catalogueId, c.rows]));
    expect(rows).toEqual(REAL_CATALOGUES);
  });

  it('sums to the row total the matcher itself reports on /health', () => {
    expect(CATALOGUES.reduce((n, c) => n + c.rows, 0)).toBe(REAL_TOTAL_ROWS);
  });

  it('maps a human-readable Colombian Spanish label 1:1 onto every real id', () => {
    const labels = CATALOGUES.map((c) => c.label);
    expect(labels).toHaveLength(8);
    expect(new Set(labels).size).toBe(8); // 1:1 — no two ids share a label
    for (const label of labels) {
      expect(label).not.toMatch(/_/); // never the raw snake_case id
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it('labels the largest food catalogue as the Restaurante Fuentes AyB table', () => {
    expect(labelFor('stock_restaurante_fuentes_ayb')).toBe('Restaurante Fuentes · AyB');
    expect(labelFor('zoologico_suministros')).toBe('Zoológico · Suministros');
  });

  it('falls back to the raw id when asked for an unknown catalogue', () => {
    expect(labelFor('stock_inexistente')).toBe('stock_inexistente');
  });

  it('recognises real ids and rejects invented ones', () => {
    expect(isCatalogueId('stock_kiosco_taquilla_ayb')).toBe(true);
    expect(isCatalogueId('bodega_042')).toBe(false);
  });

  it('orders the list by size, largest catalogue first', () => {
    const rows = CATALOGUES.map((c) => c.rows);
    expect(rows).toEqual([...rows].sort((a, b) => b - a));
    expect(CATALOGUES[0]?.catalogueId).toBe('stock_restaurante_fuentes_ayb');
  });

  it('states the RF-11 limitation instead of faking a bodega mapping', () => {
    expect(RF11_LIMITATION_NOTE).toContain('48 bodegas');
    expect(RF11_LIMITATION_NOTE).toContain('categorías');
  });
});

describe('DEMO_CATALOGUE_ID — the one bodega the demo counts', () => {
  it('is one of the 8 real matcher tables, not an invented plan id', () => {
    expect(isCatalogueId(DEMO_CATALOGUE_ID)).toBe(true);
    expect(DEMO_CATALOGUE_ID).toBe('stock_restaurante_fuentes_ayb');
  });

  it('is the largest catalogue, so the demo scripts get the best match odds', () => {
    expect(CATALOGUES[0]?.catalogueId).toBe(DEMO_CATALOGUE_ID);
    expect(CATALOGUES[0]?.rows).toBe(344);
  });

  it('resolves to the real Spanish label the operator sees, never an invented one', () => {
    expect(labelFor(DEMO_CATALOGUE_ID)).toBe('Restaurante Fuentes · AyB');
  });
});

describe('operator seed', () => {
  it('seeds exactly 3 confirmed records', () => {
    expect(OPERATOR_SEED_RECORDS).toHaveLength(3);
    expect(OPERATOR_SEED_RECORDS.every((r) => r.state === 'ok')).toBe(true);
  });

  it('seeds progress at 45 of 107', () => {
    expect(OPERATOR_SEED_PROGRESS).toEqual({ counted: 45, total: 107 });
  });

  it('gives each seed record a distinct id, a positive quantity and a Spanish display unit', () => {
    expect(new Set(OPERATOR_SEED_RECORDS.map((r) => r.id)).size).toBe(3);
    for (const record of OPERATOR_SEED_RECORDS) {
      expect(record.quantity).toBeGreaterThan(0);
      expect(record.unitDisplay).not.toBe('');
      expect(record.articulo.length).toBeGreaterThan(0);
    }
  });

  it('orders seed records newest first', () => {
    const times = OPERATOR_SEED_RECORDS.map((r) => r.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

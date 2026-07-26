/**
 * T12 — real matcher catalogues and the operator seed (REQ-OCF-8, D13).
 *
 * The 8 ids below are the REAL catalogues served by `GET /api/catalogues`.
 * If any of them drifts, the demo silently 404s on `match`, so they are pinned
 * literally here rather than derived from the module under test.
 *
 * They are `warehouses.code` values from Supabase. They REPLACED the eight
 * lowercase SQLite table names the matcher used to serve; that catalogue was
 * retired with no server-side compatibility shim, so a legacy name now answers
 * 404 `unknown_catalogue`. `RETIRED_CATALOGUE_IDS` below exists to stop one
 * from creeping back in.
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
  STOCK_ALMACEN_AYB: 270,
  STOCK_ALMACEN_SUMINISTROS: 296,
  STOCK_KIOSCO_PISCIGIROS_AYB: 56,
  STOCK_KIOSCO_TAQUILLA_AYB: 58,
  STOCK_RESTAURANTE_FUENTES_AYB: 344,
  STOCK_RESTAURANTE_FUENTES_SUMIN: 133,
  ZOOLOGICO: 55,
  // NOT `ZOOLOGICO_SUMINISTROS`. The `_2` suffix is real: Supabase already
  // held a `ZOOLOGICO_SUMINISTROS` code when this warehouse was loaded, so the
  // loader disambiguated it. Do not "correct" it — dropping the suffix loses
  // all 193 rows to a 404.
  ZOOLOGICO_SUMINISTROS_2: 193,
};

/** The matcher's own `/health` reports this total. */
const REAL_TOTAL_ROWS = 1405;

/**
 * The eight lowercase SQLite table names this frontend used to send. Every one
 * of them now answers 404 `unknown_catalogue`, so none may appear in
 * `CATALOGUES` again — the clean break was deliberate and has no shim.
 */
const RETIRED_CATALOGUE_IDS = [
  'stock_almacen_ayb',
  'stock_almacen_suministros',
  'stock_kiosco_piscigiros_ayb',
  'stock_kiosco_taquilla_ayb',
  'stock_restaurante_fuentes_ayb',
  'stock_restaurante_fuentes_sumin',
  'zoologico',
  'zoologico_suministros',
];

describe('REQ-OCF-8 — the 8 real catalogues', () => {
  it('exports exactly the 8 real catalogue ids, no more and no fewer', () => {
    expect([...CATALOGUE_IDS].sort()).toEqual(Object.keys(REAL_CATALOGUES).sort());
  });

  it('speaks the warehouse-code vocabulary, never a retired SQLite table name', () => {
    // Pins the exact eight strings. A future edit that reintroduces a legacy
    // name — or drops the ZOOLOGICO_SUMINISTROS_2 suffix — fails here rather
    // than silently 404ing the operator's match flow at runtime.
    expect([...CATALOGUE_IDS]).toEqual([
      'STOCK_RESTAURANTE_FUENTES_AYB',
      'STOCK_ALMACEN_SUMINISTROS',
      'STOCK_ALMACEN_AYB',
      'ZOOLOGICO_SUMINISTROS_2',
      'STOCK_RESTAURANTE_FUENTES_SUMIN',
      'STOCK_KIOSCO_TAQUILLA_AYB',
      'STOCK_KIOSCO_PISCIGIROS_AYB',
      'ZOOLOGICO',
    ]);
  });

  it('rejects every retired SQLite table name', () => {
    for (const retired of RETIRED_CATALOGUE_IDS) {
      expect(isCatalogueId(retired)).toBe(false);
      expect(CATALOGUE_IDS).not.toContain(retired);
    }
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
    expect(labelFor('STOCK_RESTAURANTE_FUENTES_AYB')).toBe('Restaurante Fuentes · AyB');
    expect(labelFor('ZOOLOGICO_SUMINISTROS_2')).toBe('Zoológico · Suministros');
  });

  it('falls back to the raw id when asked for an unknown catalogue', () => {
    expect(labelFor('stock_inexistente')).toBe('stock_inexistente');
  });

  it('recognises real ids and rejects invented ones', () => {
    expect(isCatalogueId('STOCK_KIOSCO_TAQUILLA_AYB')).toBe(true);
    expect(isCatalogueId('bodega_042')).toBe(false);
  });

  it('orders the list by size, largest catalogue first', () => {
    const rows = CATALOGUES.map((c) => c.rows);
    expect(rows).toEqual([...rows].sort((a, b) => b - a));
    expect(CATALOGUES[0]?.catalogueId).toBe('STOCK_RESTAURANTE_FUENTES_AYB');
  });

  it('states the RF-11 limitation instead of faking a bodega mapping', () => {
    expect(RF11_LIMITATION_NOTE).toContain('48 bodegas');
    expect(RF11_LIMITATION_NOTE).toContain('categorías');
  });
});

describe('DEMO_CATALOGUE_ID — the one bodega the demo counts', () => {
  it('is one of the 8 real matcher tables, not an invented plan id', () => {
    expect(isCatalogueId(DEMO_CATALOGUE_ID)).toBe(true);
    expect(DEMO_CATALOGUE_ID).toBe('STOCK_RESTAURANTE_FUENTES_AYB');
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

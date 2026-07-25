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
  RF11_LIMITATION_NOTE,
  isCatalogueId,
  labelFor,
} from '../../src/lib/catalogues';
import { OPERATOR_PLANS, OPERATOR_SEED_PROGRESS, OPERATOR_SEED_RECORDS } from '../../src/fixtures/operatorSeed';

/** The matcher's real tables and their row counts, verbatim. */
const REAL_CATALOGUES: Record<string, number> = {
  stock_almacen_ayb: 271,
  stock_almacen_suministros: 297,
  stock_kiosco_piscigiros_ayb: 57,
  stock_kiosco_taquilla_ayb: 59,
  stock_restaurante_fuentes_ayb: 345,
  stock_restaurante_fuentes_sumin: 134,
  zoologico: 56,
  zoologico_suministros: 194,
};

describe('REQ-OCF-8 — the 8 real catalogues', () => {
  it('exports exactly the 8 real catalogue ids, no more and no fewer', () => {
    expect([...CATALOGUE_IDS].sort()).toEqual(Object.keys(REAL_CATALOGUES).sort());
  });

  it('carries the real row count for every catalogue', () => {
    const rows = Object.fromEntries(CATALOGUES.map((c) => [c.catalogueId, c.rows]));
    expect(rows).toEqual(REAL_CATALOGUES);
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

describe('D13 — plan cards over real catalogue ids', () => {
  it('gives the "Cocina Principal" card the real stock_restaurante_fuentes_ayb id', () => {
    const cocina = OPERATOR_PLANS.find((p) => p.label === 'Cocina Principal');
    expect(cocina?.catalogueId).toBe('stock_restaurante_fuentes_ayb');
  });

  it('marks exactly one plan as the active demo plan', () => {
    expect(OPERATOR_PLANS.filter((p) => p.active)).toHaveLength(1);
    expect(OPERATOR_PLANS.find((p) => p.active)?.label).toBe('Cocina Principal');
  });

  it('backs every plan with one of the 8 real catalogue ids', () => {
    expect(OPERATOR_PLANS.length).toBeGreaterThan(0);
    for (const plan of OPERATOR_PLANS) {
      expect(isCatalogueId(plan.catalogueId)).toBe(true);
    }
  });

  it('carries the real catalogue id as the honest mono sub-line on every card', () => {
    for (const plan of OPERATOR_PLANS) {
      expect(plan.subline).toBe(plan.catalogueId);
    }
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

/**
 * T6 RED — `MockExtractionAdapter`, the Module 2 seam
 * (REQ-EXT-1, REQ-EXT-3, REQ-EXT-4, REQ-EXT-5).
 *
 * The four demo scripts are live fixtures: their expected extractions are the
 * acceptance criteria for tonight's demo, not illustrations.
 */
import { describe, expect, it } from 'vitest';

import type { ExtractionAdapter } from '../../src/lib/extraction/adapter';
import { MockExtractionAdapter } from '../../src/lib/extraction/mock';
import { DICTATION_SCRIPTS } from '../../src/fixtures/scripts';

const adapter: ExtractionAdapter = new MockExtractionAdapter();

describe('REQ-EXT-3 — demo script 1 splits into exactly three items', () => {
  const items = adapter.extract(
    'tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto',
  );

  it('yields exactly 3 items', () => {
    expect(items).toHaveLength(3);
  });

  it('yields quantities [3, 12, 2]', () => {
    expect(items.map((i) => i.quantity)).toEqual([3, 12, 2]);
  });

  it('yields units [kilos, botellas, cajas]', () => {
    expect(items.map((i) => i.unit)).toEqual(['kilos', 'botellas', 'cajas']);
  });

  it('keeps each spoken name separate and free of the unit and the "de"', () => {
    expect(items.map((i) => i.spokenName)).toEqual([
      'lechuga batavia',
      'aceite vegetal',
      'tomate chonto',
    ]);
  });
});

describe('REQ-EXT-2 — demo script 2 is the 900 anomaly trigger', () => {
  const items = adapter.extract('novecientos gramos de aceite de oliva extra virgen');

  it('yields exactly 1 item', () => {
    expect(items).toHaveLength(1);
  });

  it('yields quantity 900 and unit gramos', () => {
    expect(items[0]).toEqual({
      quantity: 900,
      unit: 'gramos',
      spokenName: 'aceite de oliva extra virgen',
    });
  });

  it('keeps "noventa" at 90 — the distinction the demo depends on', () => {
    const ninety = adapter.extract('noventa gramos de aceite de oliva extra virgen');
    expect(ninety[0]?.quantity).toBe(90);
  });
});

describe('REQ-EXT-4 — demo script 3 has no unit, only a container noun', () => {
  const items = adapter.extract('cinco tablas para picar blancas');

  it('yields exactly 1 item', () => {
    expect(items).toHaveLength(1);
  });

  it('yields quantity 5, unit null, and keeps the noun in spokenName', () => {
    // DECISION: spec REQ-EXT-4 beats the tasks.md T6 line. `tablas` is absent
    // from the matcher's UNIT_SYNONYMS, so it is not a unit; leaving it in
    // spokenName is what lets the matcher fuzzy-match "TABLA ACRILICA PICAR
    // BLANCO ..." and drive the demo to the manual-search sheet.
    expect(items[0]).toEqual({
      quantity: 5,
      unit: null,
      spokenName: 'tablas para picar blancas',
    });
  });
});

describe('demo script 4 — feminine hundreds', () => {
  const items = adapter.extract('trescientas cinco unidades de gaseosa personal');

  it('yields exactly 1 item', () => {
    expect(items).toHaveLength(1);
  });

  it('yields quantity 305 and unit unidades', () => {
    expect(items[0]).toEqual({
      quantity: 305,
      unit: 'unidades',
      spokenName: 'gaseosa personal',
    });
  });
});

describe('REQ-EXT-1 — item shape', () => {
  it('every item has a numeric quantity, string-or-null unit, non-empty spokenName', () => {
    for (const script of DICTATION_SCRIPTS) {
      for (const item of adapter.extract(script.transcript)) {
        expect(typeof item.quantity).toBe('number');
        expect(Number.isFinite(item.quantity)).toBe(true);
        expect(item.unit === null || typeof item.unit === 'string').toBe(true);
        expect(item.spokenName.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('fixtures/scripts.ts is the shared source of truth', () => {
  it('holds the four demo scripts', () => {
    expect(DICTATION_SCRIPTS).toHaveLength(4);
  });

  it.each(DICTATION_SCRIPTS.map((s, i) => [i + 1, s] as const))(
    'script %i extracts exactly what the fixture declares',
    (_n, script) => {
      expect(adapter.extract(script.transcript)).toEqual(script.expected);
    },
  );
});

describe('REQ-EXT-5 — deterministic, offline mock', () => {
  it('returns deeply equal results for the same transcript', () => {
    const transcript = 'tres kilos de lechuga batavia, doce botellas de aceite vegetal';
    expect(adapter.extract(transcript)).toEqual(adapter.extract(transcript));
  });

  it('is stateless across instances', () => {
    const other = new MockExtractionAdapter();
    expect(other.extract('dos cajas de tomate chonto')).toEqual(
      adapter.extract('dos cajas de tomate chonto'),
    );
  });
});

describe('robustness', () => {
  it('does not split "treinta y dos" — the "y" there joins a number', () => {
    const items = adapter.extract('treinta y dos unidades de gaseosa personal');
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(32);
  });

  it('yields an unresolvable unit as null rather than inventing one', () => {
    const items = adapter.extract('cuatro manojos de cilantro');
    expect(items).toHaveLength(1);
    expect(items[0]?.unit).toBeNull();
    expect(items[0]?.spokenName).toBe('manojos de cilantro');
  });

  it('ignores accents, case and extra whitespace', () => {
    expect(adapter.extract('  DOS  CAJAS de Tomate Chonto ')).toEqual([
      { quantity: 2, unit: 'cajas', spokenName: 'tomate chonto' },
    ]);
  });

  it('returns an empty array for a segment with no quantity', () => {
    expect(adapter.extract('hola buenos dias')).toEqual([]);
  });

  it('returns an empty array for an empty transcript', () => {
    expect(adapter.extract('   ')).toEqual([]);
  });

  it('drops a quantity with no article name', () => {
    expect(adapter.extract('tres kilos')).toEqual([]);
  });
});

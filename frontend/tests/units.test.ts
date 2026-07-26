/**
 * T5 RED — unit vocabulary and dimension map (REQ-EXT-4, REQ-OCF-7).
 *
 * Two DELIBERATELY DIFFERENT vocabularies live here (design §9 vs REQ-EXT-4):
 *   - `dimensionOf` answers "if this word were a unit, what does it measure?".
 *     It knows container nouns like `tablas` so the anomaly engine can treat
 *     them as counts.
 *   - `resolveSpokenUnit` answers "may the adapter EMIT this word as a unit?".
 *     `tablas` is NOT a unit word, so it resolves to null and the noun stays in
 *     `spokenName` for the matcher to fuzzy-match.
 */
import { describe, expect, it } from 'vitest';

import { dimensionOf, displayUnit, resolveSpokenUnit } from '../src/lib/units';

describe('dimensionOf', () => {
  it('classifies gramos as mass', () => {
    expect(dimensionOf('gramos')).toBe('mass');
  });

  it('classifies litros as volume', () => {
    expect(dimensionOf('litros')).toBe('volume');
  });

  it.each(['botellas', 'cajas', 'tablas', 'unidades'])(
    'classifies %s as count',
    (word) => {
      expect(dimensionOf(word)).toBe('count');
    },
  );

  it.each([
    ['kilos', 'mass'],
    ['kg', 'mass'],
    ['gramo', 'mass'],
    ['mililitros', 'volume'],
    ['l', 'volume'],
    ['und', 'count'],
    ['porciones', 'count'],
    ['paquetes', 'count'],
  ])('classifies %s as %s', (word, dimension) => {
    expect(dimensionOf(word)).toBe(dimension);
  });

  it('is accent- and case-insensitive', () => {
    expect(dimensionOf('  PORCIÓN ')).toBe('count');
  });

  it('returns null for a word outside the vocabulary — never an invented unit', () => {
    expect(dimensionOf('lechuga')).toBeNull();
  });

  it('returns null for null (a catalogue article with no unit)', () => {
    expect(dimensionOf(null)).toBeNull();
  });
});

describe('resolveSpokenUnit — what the adapter may emit', () => {
  it.each([
    ['kilos', 'kilos'],
    ['cajas', 'cajas'],
    ['unidades', 'unidades'],
    ['botellas', 'botellas'],
    ['gramos', 'gramos'],
    ['litros', 'litros'],
  ])('emits %s verbatim as spoken', (spoken, expected) => {
    expect(resolveSpokenUnit(spoken)).toBe(expected);
  });

  it('does NOT treat "tablas" as a unit (REQ-EXT-4): the noun belongs to the name', () => {
    expect(resolveSpokenUnit('tablas')).toBeNull();
  });

  it('returns null for any word outside the vocabulary', () => {
    expect(resolveSpokenUnit('lechuga')).toBeNull();
  });

  it('covers every spoken word the matcher resolves in UNIT_SYNONYMS', () => {
    const matcherSynonyms = [
      'litro', 'litros', 'lt', 'lts', 'l',
      'kilo', 'kilos', 'kilogramo', 'kilogramos', 'kg', 'kgs',
      'unidad', 'unidades', 'und', 'un',
      'paquete', 'paquetes', 'sobre', 'sobres', 'caja', 'cajas',
      'porcion', 'porciones', 'racion', 'raciones',
    ];
    for (const word of matcherSynonyms) {
      expect(resolveSpokenUnit(word)).toBe(word);
    }
  });
});

describe('displayUnit — REQ-OCF-7 nullability', () => {
  it('renders unidad_display verbatim', () => {
    expect(displayUnit('litros')).toBe('litros');
  });

  it('returns null when the catalogue has no unit — never coerced to "unidades"', () => {
    expect(displayUnit(null)).toBeNull();
  });

  it('returns null for an empty display string', () => {
    expect(displayUnit('   ')).toBeNull();
  });

  it('never leaks the raw English canonical unit', () => {
    expect(displayUnit('Kilogram')).toBeNull();
  });
});

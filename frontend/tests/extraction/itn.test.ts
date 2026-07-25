/**
 * T4 RED — Spanish inverse text normalisation (REQ-EXT-2).
 *
 * The 90-vs-900 distinction is the demo's anomaly trigger: `novecientos gramos`
 * must become 900 (out of range for an oil counted in litros), while `noventa`
 * must stay 90. If this is wrong, the live demo fails.
 */
import { describe, expect, it } from 'vitest';

import { cardinalToNumber } from '../../src/lib/extraction/itn';

describe('cardinalToNumber — the 90 vs 900 distinction', () => {
  it('maps "novecientos" to 900', () => {
    expect(cardinalToNumber('novecientos')).toBe(900);
  });

  it('maps "noventa" to 90', () => {
    expect(cardinalToNumber('noventa')).toBe(90);
  });
});

describe('cardinalToNumber — demo script cardinals', () => {
  it('maps "trescientos cinco" to 305', () => {
    expect(cardinalToNumber('trescientos cinco')).toBe(305);
  });

  it('maps the feminine "trescientas cinco" to 305', () => {
    expect(cardinalToNumber('trescientas cinco')).toBe(305);
  });

  it('maps "doce" to 12', () => {
    expect(cardinalToNumber('doce')).toBe(12);
  });

  it('maps "tres" to 3', () => {
    expect(cardinalToNumber('tres')).toBe(3);
  });

  it('maps "cinco" to 5', () => {
    expect(cardinalToNumber('cinco')).toBe(5);
  });

  it('maps "dos" to 2', () => {
    expect(cardinalToNumber('dos')).toBe(2);
  });
});

describe('cardinalToNumber — composition and gender variants', () => {
  it.each([
    ['uno', 1],
    ['una', 1],
    ['veintiuno', 21],
    ['veintiuna', 21],
    ['veinte', 20],
    ['veintidos', 22],
    ['veintidós', 22],
    ['treinta y dos', 32],
    ['cuarenta', 40],
    ['cien', 100],
    ['ciento cinco', 105],
    ['doscientos', 200],
    ['doscientas', 200],
    ['quinientos', 500],
    ['setecientas cincuenta', 750],
    ['novecientos noventa y nueve', 999],
    ['mil', 1000],
    ['dos mil quince', 2015],
    ['cero', 0],
  ])('maps "%s" to %i', (spoken, expected) => {
    expect(cardinalToNumber(spoken)).toBe(expected);
  });

  it('accepts digits already written as digits', () => {
    expect(cardinalToNumber('900')).toBe(900);
  });

  it('is accent- and case-insensitive', () => {
    expect(cardinalToNumber('  NOVECIENTOS  ')).toBe(900);
  });

  it('returns null for a word that is not a cardinal', () => {
    expect(cardinalToNumber('tablas')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(cardinalToNumber('')).toBeNull();
  });
});

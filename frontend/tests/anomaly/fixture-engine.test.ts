/**
 * T8 RED — `FixtureAnomalyEngine`, the Module 4 seam (REQ-OCF-5, D11).
 *
 * Two deterministic rules only, per design §9:
 *   (a) unit-dimension mismatch, firing ONLY on mass <-> volume, so container
 *       nouns stay compatible with everything and demo script 1 never
 *       false-fires;
 *   (b) out-of-range quantity against the learned-ranges fixture.
 *
 * The Spanish copy asserted here is verbatim from the design contract §2 S6.
 */
import { describe, expect, it } from 'vitest';

import type { AnomalyEngine } from '../../src/lib/anomaly/engine';
import { FixtureAnomalyEngine } from '../../src/lib/anomaly/fixtureEngine';
import { LEARNED_RANGES } from '../../src/fixtures/anomalyRules';
import type { Candidate, MatchResponse } from '../../src/lib/api/types';
import type { ConfirmableItem } from '../../src/lib/pipeline';
import type { ExtractedItem } from '../../src/lib/extraction/adapter';

const engine: AnomalyEngine = new FixtureAnomalyEngine();

function confirmable(
  extracted: ExtractedItem,
  candidate: Partial<Candidate> & Pick<Candidate, 'articulo'>,
): ConfirmableItem {
  const picked: Candidate = {
    nr_articulo: null,
    unidad: null,
    unidad_display: null,
    score: 0.97,
    ...candidate,
  };
  const match: MatchResponse = {
    status: 'matched',
    candidates: [picked],
    top_score: picked.score,
    margin: 0.4,
    request_id: 'test-request',
  };
  return { extracted, match, picked };
}

describe('rule (a) — mass vs volume mismatch, RF-26(b)', () => {
  const anomaly = engine.check(
    confirmable(
      { quantity: 900, unit: 'gramos', spokenName: 'aceite de oliva extra virgen' },
      { articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML', unidad_display: 'litros' },
    ),
  );

  it('fires with kind "unidad"', () => {
    expect(anomaly?.kind).toBe('unidad');
  });

  it('carries the design contract copy verbatim', () => {
    expect(anomaly).toEqual({
      kind: 'unidad',
      title: 'Revisa la unidad antes de seguir',
      reason:
        'Este artículo se cuenta en litros (L), no en gramos. 900 g no corresponde a esta bodega.',
      hint: 'Escuché “novecientos” y lo escribí 900 · regla de unidad RF-26(b)',
    });
  });

  it('takes precedence over the range rule when both would fire', () => {
    // 900 is also outside the learned 2-8 L range for this oil; the unit
    // problem is the one the operator must see first.
    expect(anomaly?.kind).toBe('unidad');
  });

  it('does not fire when the spoken unit agrees in dimension', () => {
    expect(
      engine.check(
        confirmable(
          { quantity: 4, unit: 'litros', spokenName: 'aceite de oliva extra virgen' },
          { articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML', unidad_display: 'litros' },
        ),
      ),
    ).toBeNull();
  });

  it('does not fire when the operator said no unit at all', () => {
    expect(
      engine.check(
        confirmable(
          { quantity: 5, unit: null, spokenName: 'tablas para picar blancas' },
          { articulo: 'TABLA ACRILICA PICAR BLANCO 50X38CM FB', unidad_display: 'unidades' },
        ),
      ),
    ).toBeNull();
  });

  it('does not fire when the catalogue article has no unit', () => {
    expect(
      engine.check(
        confirmable(
          { quantity: 900, unit: 'gramos', spokenName: 'algo sin unidad' },
          { articulo: 'ARTICULO SIN UNIDAD', unidad_display: null },
        ),
      ),
    ).toBeNull();
  });
});

describe('rule (b) — quantity outside the learned range, RF-26(c)', () => {
  const anomaly = engine.check(
    confirmable(
      { quantity: 305, unit: 'unidades', spokenName: 'gaseosa personal' },
      { articulo: 'GASEOSA PERSONAL 400ML', unidad_display: 'unidades' },
    ),
  );

  it('fires with kind "cantidad"', () => {
    expect(anomaly?.kind).toBe('cantidad');
  });

  it('carries the design contract copy verbatim', () => {
    expect(anomaly).toEqual({
      kind: 'cantidad',
      title: 'Cantidad fuera de lo habitual',
      reason:
        'Aquí normalmente se cuentan entre 20 y 40 unidades. 305 es 10 veces lo esperado.',
      hint: 'Si de verdad hay 305, deja la nota y el auditor la revisa · RF-26(c)',
    });
  });

  it('does not fire inside the range', () => {
    expect(
      engine.check(
        confirmable(
          { quantity: 32, unit: 'unidades', spokenName: 'gaseosa personal' },
          { articulo: 'GASEOSA PERSONAL 400ML', unidad_display: 'unidades' },
        ),
      ),
    ).toBeNull();
  });

  it('does not fire for an article with no learned range', () => {
    expect(
      engine.check(
        confirmable(
          { quantity: 4000, unit: 'unidades', spokenName: 'servilletas' },
          { articulo: 'SERVILLETA BLANCA X 100', unidad_display: 'unidades' },
        ),
      ),
    ).toBeNull();
  });

  it('fires below the range too', () => {
    const low = engine.check(
      confirmable(
        { quantity: 1, unit: 'unidades', spokenName: 'gaseosa personal' },
        { articulo: 'GASEOSA PERSONAL 400ML', unidad_display: 'unidades' },
      ),
    );
    expect(low?.kind).toBe('cantidad');
    expect(low?.reason).toBe(
      'Aquí normalmente se cuentan entre 20 y 40 unidades. 1 está por debajo de lo habitual.',
    );
  });
});

describe('no false positives on demo script 1 — the three container items', () => {
  const scriptOneItems: ConfirmableItem[] = [
    confirmable(
      { quantity: 3, unit: 'kilos', spokenName: 'lechuga batavia' },
      { articulo: 'LECHUGA BATAVIA', unidad_display: 'kg' },
    ),
    confirmable(
      { quantity: 12, unit: 'botellas', spokenName: 'aceite vegetal' },
      { articulo: 'ACEITE VEGETAL GIRASOL 3L', unidad_display: 'unidades' },
    ),
    confirmable(
      { quantity: 2, unit: 'cajas', spokenName: 'tomate chonto' },
      { articulo: 'TOMATE CHONTO X 10KG', unidad_display: 'unidades' },
    ),
  ];

  it.each(scriptOneItems.map((item, i) => [i + 1, item] as const))(
    'item %i returns null',
    (_n, item) => {
      expect(engine.check(item)).toBeNull();
    },
  );
});

describe('the learned-ranges fixture', () => {
  it('holds the five ranges from the design contract', () => {
    expect(LEARNED_RANGES).toEqual([
      { nameKeyword: 'aceite de oliva', unit: 'litros', min: 2, max: 8 },
      { nameKeyword: 'gaseosa personal', unit: 'unidades', min: 20, max: 40 },
      { nameKeyword: 'lechuga batavia', unit: 'kg', min: 1.5, max: 6 },
      { nameKeyword: 'arroz blanco', unit: 'kg', min: 3, max: 12 },
      { nameKeyword: 'pechuga pollo', unit: 'unidades', min: 12, max: 40 },
    ]);
  });
});

describe('REQ-OCF-5 — deterministic and swappable', () => {
  it('returns an equal result for the same item', () => {
    const item = confirmable(
      { quantity: 305, unit: 'unidades', spokenName: 'gaseosa personal' },
      { articulo: 'GASEOSA PERSONAL 400ML', unidad_display: 'unidades' },
    );
    expect(engine.check(item)).toEqual(engine.check(item));
  });

  it('satisfies the frozen AnomalyEngine interface, so a real service can replace it', () => {
    const swapped: AnomalyEngine = { check: () => null };
    expect(swapped.check).toBeTypeOf('function');
    expect(engine.check).toBeTypeOf('function');
  });
});

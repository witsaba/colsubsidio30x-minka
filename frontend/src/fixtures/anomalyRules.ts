/**
 * Learned quantity ranges — the "Rangos aprendidos por artículo" fixture,
 * verbatim from the design contract §3 (auditor `base` view).
 *
 * This stands in for Module 4's learned statistics. It is a FIXTURE, not a
 * model: five articles, hand-copied from the design. `nameKeyword` is matched
 * case-insensitively as a substring of `Candidate.articulo`.
 */

export interface LearnedRange {
  /** Lowercase substring matched against `Candidate.articulo`. */
  nameKeyword: string;
  /** The `unidad_display` the range is expressed in. */
  unit: string;
  min: number;
  max: number;
}

export const LEARNED_RANGES: readonly LearnedRange[] = [
  // ACEITE DE OLIVA EXTRA VIRGEN 500ML · L · 2 – 8
  { nameKeyword: 'aceite de oliva', unit: 'litros', min: 2, max: 8 },
  // GASEOSA PERSONAL 400ML · UND · 20 – 40  (the demo's RF-26(c) trigger)
  { nameKeyword: 'gaseosa personal', unit: 'unidades', min: 20, max: 40 },
  // LECHUGA BATAVIA · KG · 1,5 – 6
  { nameKeyword: 'lechuga batavia', unit: 'kg', min: 1.5, max: 6 },
  // ARROZ BLANCO PREPARADO · KG · 3 – 12
  { nameKeyword: 'arroz blanco', unit: 'kg', min: 3, max: 12 },
  // PECHUGA POLLO FILETE X 180G · UND · 12 – 40
  { nameKeyword: 'pechuga pollo', unit: 'unidades', min: 12, max: 40 },
] as const;

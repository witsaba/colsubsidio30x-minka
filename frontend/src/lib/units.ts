/**
 * Unit vocabulary, dimensions and display rules (REQ-EXT-4, REQ-OCF-7).
 *
 * Owner: T5. T6 and T8 import from here and never edit this file.
 *
 * THREE separate concerns, deliberately not collapsed into one map:
 *
 * 1. `resolveSpokenUnit(word)` — the EMISSION vocabulary. The extraction
 *    adapter may only emit a unit the operator actually said AND that this
 *    vocabulary knows. It is anchored on the matcher's `UNIT_SYNONYMS`
 *    (`services/matcher/src/matcher/units.py:23-38`) plus the measure words the
 *    demo scripts use that the matcher leaves unresolved (`gramos`,
 *    `botellas`). The matcher treats an unresolved unit as `None` — never an
 *    error — so passing them through is safe, and REQ-EXT-4 explicitly allows
 *    it. What is NOT allowed is inventing unit words of our own.
 *
 *    DECISION (records the tasks.md T6 vs spec REQ-EXT-4 contradiction):
 *    `tablas` is a container NOUN, not a measure word, and it is absent from
 *    `UNIT_SYNONYMS`. The spec wins: `extract('cinco tablas para picar
 *    blancas')` yields `unit: null` and keeps "tablas para picar blancas" in
 *    `spokenName`, so the matcher can fuzzy-match the article and the demo
 *    reaches the manual-search sheet as designed.
 *
 * 2. `dimensionOf(word)` — the MEASUREMENT classification used by the anomaly
 *    engine. It is a SUPERSET of the emission vocabulary: it also classifies
 *    container nouns such as `tablas` as `count`, because the engine must be
 *    able to reason about any word it is handed (design §9). Being in this map
 *    does NOT make a word emittable as a unit.
 *
 * 3. `displayUnit(value)` — presentation. Renders the matcher's
 *    `unidad_display` and nothing else. A null/blank unit renders as absent; it
 *    is never coerced to "unidades", and the raw English canonical unit
 *    (`Kilogram`, `Liter`, ...) must never reach the UI.
 */

/** What a unit measures. `count` is compatible with everything. */
export type Dimension = 'mass' | 'volume' | 'count';

/** Lowercase, strip accents, collapse whitespace. */
function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Spoken word -> dimension. Keys are accent-stripped and lowercase.
 *
 * Mass and volume are the only pair that can conflict; every container noun is
 * a `count` and therefore compatible with anything, which is exactly what keeps
 * demo script 1 ("doce botellas", "dos cajas") free of false anomalies.
 */
const DIMENSIONS: Readonly<Record<string, Dimension>> = {
  // mass
  gramo: 'mass',
  gramos: 'mass',
  g: 'mass',
  gr: 'mass',
  grs: 'mass',
  kilo: 'mass',
  kilos: 'mass',
  kilogramo: 'mass',
  kilogramos: 'mass',
  kg: 'mass',
  kgs: 'mass',
  libra: 'mass',
  libras: 'mass',

  // volume
  litro: 'volume',
  litros: 'volume',
  lt: 'volume',
  lts: 'volume',
  l: 'volume',
  mililitro: 'volume',
  mililitros: 'volume',
  ml: 'volume',

  // count — units, containers and portions
  unidad: 'count',
  unidades: 'count',
  und: 'count',
  un: 'count',
  paquete: 'count',
  paquetes: 'count',
  sobre: 'count',
  sobres: 'count',
  caja: 'count',
  cajas: 'count',
  bolsa: 'count',
  bolsas: 'count',
  botella: 'count',
  botellas: 'count',
  // container nouns: classified so the engine can reason about them, but NOT
  // emittable as units (see `SPOKEN_UNITS`).
  tabla: 'count',
  tablas: 'count',
  bandeja: 'count',
  bandejas: 'count',
  porcion: 'count',
  porciones: 'count',
  racion: 'count',
  raciones: 'count',
};

/**
 * The words the extraction adapter may emit as `ExtractedItem.unit`.
 *
 * = the matcher's `UNIT_SYNONYMS` + the measure words the demo scripts use that
 * the matcher leaves unresolved. Container NOUNS (`tablas`, `bandejas`) are
 * excluded on purpose — see the decision note at the top of this file.
 */
const SPOKEN_UNITS: ReadonlySet<string> = new Set([
  // matcher UNIT_SYNONYMS — Liter
  'litro', 'litros', 'lt', 'lts', 'l',
  // matcher UNIT_SYNONYMS — Kilogram
  'kilo', 'kilos', 'kilogramo', 'kilogramos', 'kg', 'kgs',
  // matcher UNIT_SYNONYMS — Unidad
  'unidad', 'unidades', 'und', 'un', 'paquete', 'paquetes', 'sobre', 'sobres',
  'caja', 'cajas',
  // matcher UNIT_SYNONYMS — Portion
  'porcion', 'porciones', 'racion', 'raciones',
  // measure words the matcher does not resolve, allowed by REQ-EXT-4 because
  // the operator genuinely says them and the matcher degrades to None.
  'gramo', 'gramos', 'g', 'gr', 'grs',
  'mililitro', 'mililitros', 'ml',
  'botella', 'botellas',
  'bolsa', 'bolsas',
  'libra', 'libras',
]);

/**
 * What the given spoken unit or `unidad_display` measures, or `null` when the
 * word is outside the vocabulary (an unknown word is never coerced).
 */
export function dimensionOf(word: string | null | undefined): Dimension | null {
  if (word === null || word === undefined) return null;
  const key = normalizeWord(word);
  if (key === '') return null;
  return DIMENSIONS[key] ?? null;
}

/**
 * The unit the adapter may emit for this spoken word, verbatim as spoken, or
 * `null` when the word is not a unit at all.
 */
export function resolveSpokenUnit(word: string | null | undefined): string | null {
  if (word === null || word === undefined) return null;
  const key = normalizeWord(word);
  if (key === '') return null;
  return SPOKEN_UNITS.has(key) ? key : null;
}

/** The canonical English units the matcher stores; they must never be rendered. */
const CANONICAL_UNITS: ReadonlySet<string> = new Set([
  'kilogram',
  'liter',
  'litre',
  'unidad',
  'portion',
]);

/**
 * Render `Candidate.unidad_display` and nothing else (REQ-OCF-7).
 *
 * Returns `null` — meaning "render no unit at all" — for a null/blank value or
 * for a raw canonical English unit that leaked through. Callers must omit the
 * unit element entirely rather than substituting a default.
 */
export function displayUnit(unidadDisplay: string | null | undefined): string | null {
  if (unidadDisplay === null || unidadDisplay === undefined) return null;
  const trimmed = unidadDisplay.trim();
  if (trimmed === '') return null;
  if (CANONICAL_UNITS.has(normalizeWord(trimmed))) return null;
  return trimmed;
}

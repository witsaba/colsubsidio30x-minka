/**
 * `FixtureAnomalyEngine` — the Module 4 seam (REQ-OCF-5, D11, design §9).
 *
 * Module 4 (anomaly detection) does NOT exist. This is a deterministic,
 * fixture-driven MOCK with exactly TWO rules and no network:
 *
 *   (a) UNIT-DIMENSION MISMATCH, RF-26(b) — fires only when the spoken unit and
 *       the catalogue's `unidad_display` disagree across mass <-> volume.
 *       Everything classified as `count` (unidades, botellas, cajas, tablas,
 *       porciones) is compatible with anything, which is precisely what keeps
 *       demo script 1 free of false positives.
 *   (b) OUT-OF-RANGE QUANTITY, RF-26(c) — the quantity falls outside the
 *       learned range fixture for the matched article.
 *
 * Rule (a) wins when both would fire: a wrong unit makes the quantity
 * meaningless, so the operator must see the unit problem first.
 *
 * SWAP POINT: `AnomalyEngine` is constructor-injected into `runPipeline` via
 * `PipelineDeps.anomalies`. A real Module 4 ships as
 * `HttpAnomalyEngine implements AnomalyEngine` calling its service, and NO call
 * site changes. Nothing outside this file may reference `FixtureAnomalyEngine`
 * except the single composition root that builds `PipelineDeps`.
 */
import type { Anomaly, AnomalyEngine } from './engine';
import type { ConfirmableItem } from '../pipeline';
import { dimensionOf } from '../units';
import { numberToCardinal } from '../extraction/itn';
import { LEARNED_RANGES, type LearnedRange } from '../../fixtures/anomalyRules';

/** Short forms used in the Spanish anomaly copy ("900 g", "litros (L)"). */
const UNIT_ABBREVIATIONS: Readonly<Record<string, string>> = {
  litros: 'L',
  litro: 'L',
  mililitros: 'ml',
  gramos: 'g',
  gramo: 'g',
  kilos: 'kg',
  kilo: 'kg',
  kg: 'kg',
  unidades: 'und',
  porciones: 'porc',
};

function abbreviate(unit: string): string {
  return UNIT_ABBREVIATIONS[unit.toLowerCase()] ?? unit;
}

/** Colombian decimal notation: 1.5 renders as "1,5", 20 renders as "20". */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function findRange(articulo: string): LearnedRange | null {
  const haystack = normalize(articulo);
  return (
    LEARNED_RANGES.find((range) => haystack.includes(normalize(range.nameKeyword))) ?? null
  );
}

function checkUnitMismatch(item: ConfirmableItem): Anomaly | null {
  const spokenUnit = item.extracted.unit;
  const catalogueUnit = item.picked.unidad_display;
  if (spokenUnit === null || catalogueUnit === null) return null;

  const spokenDimension = dimensionOf(spokenUnit);
  const catalogueDimension = dimensionOf(catalogueUnit);
  if (spokenDimension === null || catalogueDimension === null) return null;

  // ONLY mass <-> volume conflicts. `count` is compatible with everything.
  const conflicting =
    (spokenDimension === 'mass' && catalogueDimension === 'volume') ||
    (spokenDimension === 'volume' && catalogueDimension === 'mass');
  if (!conflicting) return null;

  const quantity = item.extracted.quantity;
  const spokenWord = numberToCardinal(quantity);
  const heard =
    spokenWord === null
      ? `Escuché la cantidad y la escribí ${formatNumber(quantity)}`
      : `Escuché “${spokenWord}” y lo escribí ${formatNumber(quantity)}`;

  return {
    kind: 'unidad',
    title: 'Revisa la unidad antes de seguir',
    reason:
      `Este artículo se cuenta en ${catalogueUnit} (${abbreviate(catalogueUnit)}), ` +
      `no en ${spokenUnit}. ${formatNumber(quantity)} ${abbreviate(spokenUnit)} ` +
      'no corresponde a esta bodega.',
    hint: `${heard} · regla de unidad RF-26(b)`,
  };
}

function checkQuantityRange(item: ConfirmableItem): Anomaly | null {
  const range = findRange(item.picked.articulo);
  if (range === null) return null;

  // Only compare quantities that measure the same thing as the range.
  const rangeDimension = dimensionOf(range.unit);
  const spokenDimension = dimensionOf(item.extracted.unit);
  if (spokenDimension !== null && rangeDimension !== null && spokenDimension !== rangeDimension) {
    return null;
  }

  const quantity = item.extracted.quantity;
  if (quantity >= range.min && quantity <= range.max) return null;

  const midpoint = (range.min + range.max) / 2;
  const times = midpoint > 0 ? Math.round(quantity / midpoint) : 0;
  const comparison =
    quantity > range.max && times >= 2
      ? `${formatNumber(quantity)} es ${times} veces lo esperado.`
      : quantity > range.max
        ? `${formatNumber(quantity)} está por encima de lo habitual.`
        : `${formatNumber(quantity)} está por debajo de lo habitual.`;

  return {
    kind: 'cantidad',
    title: 'Cantidad fuera de lo habitual',
    reason:
      `Aquí normalmente se cuentan entre ${formatNumber(range.min)} y ` +
      `${formatNumber(range.max)} ${range.unit}. ${comparison}`,
    hint:
      `Si de verdad hay ${formatNumber(quantity)}, deja la nota y el auditor ` +
      'la revisa · RF-26(c)',
  };
}

export class FixtureAnomalyEngine implements AnomalyEngine {
  /**
   * `async` only to satisfy the seam (design D4). The two rules below stay
   * synchronous pure functions; nothing here awaits anything.
   */
  async check(item: ConfirmableItem): Promise<Anomaly | null> {
    return checkUnitMismatch(item) ?? checkQuantityRange(item);
  }
}

/** The single instance the composition root wires into `PipelineDeps`. */
export const fixtureAnomalyEngine: AnomalyEngine = new FixtureAnomalyEngine();

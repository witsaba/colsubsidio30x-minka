/**
 * Server-side anomaly validation (REQ-AV-1/3, RF-25/26/27, design D3/D4).
 *
 * This is the only module that reads the statistical bounds
 * (`product_count_ranges`) and the theoretical stock
 * (`warehouse_stock_balances`). Everything the operator ever receives about an
 * anomaly passes through `toOperatorVerdict` first.
 *
 * BLIND COUNTING (RF-18) is enforced here, at the serialization boundary, and
 * not in the renderer. The internal verdict deliberately CARRIES the bounds and
 * the theoretical quantity, because `POST /api/records` writes them to
 * `record_anomalies` for the auditor; the operator projection deletes them.
 * Access control belongs at the boundary, not in the UI — a filter in a
 * component is one refactor away from being removed by someone who does not
 * know why it was there.
 *
 * `anomaly_evidence` is auditor-only material and is NEVER joined from any code
 * path reachable by an operator request.
 */
import type { Db } from './db';

/* -------------------------------------------------------------------------- */
/* Column names                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Centralised so a schema delta is a one-line fix rather than a hunt.
 *
 * NOTE (task 1.1): these names come from `docs/database/*` plus the design's
 * column list. Live-schema re-verification via the Supabase MCP tools could not
 * be performed in this apply session (the tools were not available to the
 * executor), so they remain UNVERIFIED against the running project.
 */
const RANGES_TABLE = 'product_count_ranges';
const BALANCES_TABLE = 'warehouse_stock_balances';

/* -------------------------------------------------------------------------- */
/* Contracts                                                                  */
/* -------------------------------------------------------------------------- */

export interface CountFacts {
  planId: string;
  warehouseId: string;
  productId: string;
  quantity: number;
  /** Null when the dictation carried no unit at all (REQ-EXT-4). */
  unitCode: string | null;
}

export type AnomalyType = 'unit_mismatch' | 'atypical_quantity' | 'negative_balance';
export type AnomalySeverity = 'warning' | 'error';

/**
 * The SERVER-INTERNAL verdict. Carries the sensitive figures; never serialized
 * to an operator. Consumed by `POST /api/records` to write `record_anomalies`.
 */
export interface InternalAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  /** Operator-safe: no figures, ever (see `toOperatorVerdict`). */
  title: string;
  /** Auditor-facing explanation. MAY contain figures. */
  detail: string;
  expectedUnitCode: string | null;
  expectedMin: number | null;
  expectedMax: number | null;
  theoreticalQty: number | null;
}

export interface InternalVerdict {
  verdict: 'ok' | AnomalySeverity;
  anomaly: InternalAnomaly | null;
}

/** The ONLY anomaly shape an operator-facing route may serialize (RF-18). */
export interface OperatorVerdict {
  verdict: 'ok' | AnomalySeverity;
  anomaly: { type: AnomalyType; severity: AnomalySeverity; title: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Operator-safe copy                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Titles are static strings with NO interpolated figures.
 *
 * `negative_balance` deliberately reuses the neutral quantity wording: a title
 * such as "greater than the system balance" would hand the operator a bound on
 * the theoretical stock, which is exactly what RF-18 forbids.
 */
const TITLES: Readonly<Record<AnomalyType, string>> = {
  unit_mismatch: 'Revisa la unidad antes de seguir',
  atypical_quantity: 'Cantidad fuera de lo habitual',
  negative_balance: 'Cantidad fuera de lo habitual',
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

interface CountRange {
  expectedMin: number | null;
  expectedMax: number | null;
  expectedUnitCode: string | null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readRange(db: Db, facts: CountFacts): Promise<CountRange | null> {
  const { data } = await db
    .from(RANGES_TABLE)
    .select('expected_min, expected_max, expected_unit_code')
    .eq('product_id', facts.productId)
    .eq('warehouse_id', facts.warehouseId)
    .maybeSingle();

  if (!data) return null;
  return {
    expectedMin: numberOrNull(data.expected_min),
    expectedMax: numberOrNull(data.expected_max),
    expectedUnitCode: typeof data.expected_unit_code === 'string' ? data.expected_unit_code : null,
  };
}

async function readTheoretical(db: Db, facts: CountFacts): Promise<number | null> {
  const { data } = await db
    .from(BALANCES_TABLE)
    .select('theoretical_qty')
    .eq('product_id', facts.productId)
    .eq('warehouse_id', facts.warehouseId)
    .maybeSingle();

  return data ? numberOrNull(data.theoretical_qty) : null;
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

function anomaly(
  type: AnomalyType,
  severity: AnomalySeverity,
  detail: string,
  range: CountRange | null,
  theoreticalQty: number | null,
): InternalAnomaly {
  return {
    type,
    severity,
    title: TITLES[type],
    detail,
    expectedUnitCode: range?.expectedUnitCode ?? null,
    expectedMin: range?.expectedMin ?? null,
    expectedMax: range?.expectedMax ?? null,
    theoreticalQty,
  };
}

/**
 * RF-26(b). A dictation with no unit is NOT a mismatch: the operator simply
 * said "twenty", and inventing a conflict there would be a false positive.
 */
function checkUnit(facts: CountFacts, range: CountRange | null): string | null {
  const expected = range?.expectedUnitCode ?? null;
  if (facts.unitCode === null || expected === null) return null;
  if (facts.unitCode.toUpperCase() === expected.toUpperCase()) return null;
  return `Unidad dictada ${facts.unitCode}; el catálogo cuenta este artículo en ${expected}.`;
}

/** RF-26(c). */
function checkRange(facts: CountFacts, range: CountRange | null): string | null {
  if (!range) return null;
  const { expectedMin, expectedMax } = range;
  if (expectedMax !== null && facts.quantity > expectedMax) {
    return `Cantidad ${facts.quantity} por encima del máximo esperado ${expectedMax}.`;
  }
  if (expectedMin !== null && facts.quantity < expectedMin) {
    return `Cantidad ${facts.quantity} por debajo del mínimo esperado ${expectedMin}.`;
  }
  return null;
}

/** RF-26(a): the count would drive the system balance negative. */
function checkBalance(facts: CountFacts, theoreticalQty: number | null): string | null {
  if (theoreticalQty === null || facts.quantity <= theoreticalQty) return null;
  return `Cantidad ${facts.quantity} supera el saldo teórico ${theoreticalQty}.`;
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Validate one count against the real catalogue statistics.
 *
 * Precedence is unit -> range -> balance and mirrors the fixture engine: a
 * wrong unit makes the quantity meaningless, so the operator must be shown the
 * unit problem first.
 */
export async function validateCount(db: Db, facts: CountFacts): Promise<InternalVerdict> {
  const range = await readRange(db, facts);
  const theoreticalQty = await readTheoretical(db, facts);

  const unitDetail = checkUnit(facts, range);
  if (unitDetail) {
    return { verdict: 'error', anomaly: anomaly('unit_mismatch', 'error', unitDetail, range, theoreticalQty) };
  }

  const rangeDetail = checkRange(facts, range);
  if (rangeDetail) {
    return {
      verdict: 'warning',
      anomaly: anomaly('atypical_quantity', 'warning', rangeDetail, range, theoreticalQty),
    };
  }

  const balanceDetail = checkBalance(facts, theoreticalQty);
  if (balanceDetail) {
    return {
      verdict: 'warning',
      anomaly: anomaly('negative_balance', 'warning', balanceDetail, range, theoreticalQty),
    };
  }

  return { verdict: 'ok', anomaly: null };
}

/**
 * Project an internal verdict onto the ONLY shape an operator may receive.
 *
 * Written as an explicit construction, never as a `delete` or a spread-minus:
 * a new sensitive field added to `InternalAnomaly` must be opted IN here, so
 * the safe default is "not disclosed" (RF-18, REQ-AV-3).
 */
export function toOperatorVerdict(internal: InternalVerdict): OperatorVerdict {
  const { anomaly: found } = internal;
  return {
    verdict: internal.verdict,
    anomaly: found ? { type: found.type, severity: found.severity, title: found.title } : null,
  };
}

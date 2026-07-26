/**
 * `HttpAnomalyEngine` — the real Module 4 (design D4, REQ-AV-1/3).
 *
 * `engine.ts` promised this exact swap: "a real anomaly service later ships as
 * `HttpAnomalyEngine implements AnomalyEngine` with zero call-site changes,
 * because the engine is constructor-injected via `PipelineDeps`". Nothing in
 * `runPipeline` changes; only the composition root picks a different engine.
 *
 * BLIND COUNTING (RF-18). The service answers with a verdict, a type and a
 * title — no bounds, no theoretical stock. The operator copy (`reason`,
 * `hint`) is composed HERE from a static table, so there is no figure to leak
 * even if the service were later loosened: this module has nothing to render.
 *
 * Failure is silent by design. An anomaly check that cannot reach the server
 * must not break the dictation chain — the operator would be stuck mid-count
 * with no way forward. A missed warning is recoverable by the auditor; a dead
 * pipeline is not (RF-29 spirit).
 */
import type { Anomaly, AnomalyEngine } from './engine';
import type { ConfirmableItem } from '../pipeline';

const ANOMALY_CHECK_URL = '/api/anomaly-check';

type ServerAnomalyType = 'unit_mismatch' | 'atypical_quantity' | 'negative_balance';

/** The allowlisted verdict shape `toOperatorVerdict` emits. */
interface OperatorVerdict {
  verdict: 'ok' | 'warning' | 'error';
  anomaly: { type: ServerAnomalyType; severity: 'warning' | 'error'; title: string } | null;
}

/**
 * Static, figure-free copy. Keyed by the server's anomaly type, which is the
 * ONLY discriminator that crosses the wire.
 */
const COPY: Readonly<Record<ServerAnomalyType, Pick<Anomaly, 'kind' | 'reason' | 'hint'>>> = {
  unit_mismatch: {
    kind: 'unidad',
    reason: 'La unidad que dictaste no coincide con la unidad en que se cuenta este artículo.',
    hint: 'Vuelve a dictar con la unidad del artículo · regla de unidad RF-26(b)',
  },
  atypical_quantity: {
    kind: 'cantidad',
    reason: 'La cantidad que dictaste está fuera de lo habitual para este artículo en esta bodega.',
    hint: 'Si de verdad es así, deja la nota y el auditor la revisa · RF-26(c)',
  },
  negative_balance: {
    kind: 'cantidad',
    reason: 'La cantidad que dictaste está fuera de lo habitual para este artículo en esta bodega.',
    hint: 'Si de verdad es así, deja la nota y el auditor la revisa · RF-26(a)',
  },
};

/**
 * Session context the engine needs but `ConfirmableItem` does not carry.
 *
 * `productIdOf` is a seam rather than a field because the matcher answers with
 * catalogue rows (`nr_articulo`), not Supabase product uuids: resolving one to
 * the other is the caller's job and differs between the demo catalogue and the
 * real plan.
 */
export interface AnomalyCheckContext {
  planId: string;
  warehouseId: string;
  productIdOf(item: ConfirmableItem): string | null;
}

function toAnomaly(verdict: OperatorVerdict): Anomaly | null {
  if (!verdict.anomaly) return null;
  const copy = COPY[verdict.anomaly.type];
  if (!copy) return null;
  return { kind: copy.kind, title: verdict.anomaly.title, reason: copy.reason, hint: copy.hint };
}

export function createHttpAnomalyEngine(
  context: AnomalyCheckContext,
  fetchFn: typeof fetch = fetch,
): AnomalyEngine {
  return {
    async check(item: ConfirmableItem): Promise<Anomaly | null> {
      const productId = context.productIdOf(item);
      const nrArticulo = item.picked.nr_articulo;
      const articulo = item.picked.articulo;
      // No catalogue identity at all, nothing to validate against: stay silent
      // rather than invent an anomaly the auditor cannot trace to a product.
      // An `nr_articulo` OR the catalogue name is enough — the route resolves
      // either to a uuid, and ~18.4% of the catalogue has no sku at all (6.10).
      if (!productId && !nrArticulo && !articulo) return null;

      try {
        const response = await fetchFn(ANOMALY_CHECK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            planId: context.planId,
            warehouseId: context.warehouseId,
            productId,
            nrArticulo,
            articulo,
            quantity: item.extracted.quantity,
            // The CANONICAL catalogue unit, not the Spanish one the operator
            // dictated: `POST /api/records` re-runs this same validation and
            // writes this same code to `count_records.unit_code` (design D4),
            // so the advisory and the authoritative verdict must be computed
            // from identical facts.
            unitCode: item.picked.unidad,
          }),
        });
        if (!response.ok) return null;
        return toAnomaly((await response.json()) as OperatorVerdict);
      } catch {
        return null;
      }
    },
  };
}

/**
 * S2 «Planes asignados» — plan selection over the operator's ASSIGNED AUDIT
 * PLANS (REQ-OCF-8, REQ-SDA-3, RF-11, RF-07).
 *
 * HISTORY, because the change matters: this screen used to render the 8 real
 * matcher catalogues from `lib/catalogues.ts` and state the RF-11 limitation
 * verbatim, because no plan table was reachable from the browser. It now reads
 * `GET /api/plans?operator=`, which starts from `plan_operators` and can only
 * ever answer with plans assigned to this operator. The limitation note is gone
 * because the limitation is gone: the plan carries its own warehouse and its own
 * catalogue, so nothing is inferred from a bodega name any more.
 *
 * The fetch is a PROP SEAM defaulted to the real client, the same pattern the
 * pipeline uses — the component owns the loading/error/empty states, and tests
 * never touch the network.
 *
 * Blind counting binds this screen too (RF-18): a plan card names the plan, and
 * never a theoretical stock value.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';

import { fetchPlans as realFetchPlans, type PlanSummary } from '../../lib/api/operational';
import type { SessionEvent } from '../../lib/session/types';

export interface PlansScreenProps {
  dispatch: (event: SessionEvent) => void;
  /** Identifies the operator whose assignments are listed (design D2). */
  operatorId: string;
  /** Default 'Pablo' matches the design's demo operator. */
  operatorName?: string;
  /** Injectable for tests; production uses the real `GET /api/plans`. */
  loadPlans?: (operatorId: string, opts?: { signal?: AbortSignal }) => Promise<PlanSummary[]>;
}

const FOOTER_NOTE = 'Solo ves las bodegas que te asignaron. El conteo es ciego.';
const LOADING_NOTE = 'Cargando tus conteos asignados…';
const EMPTY_NOTE = 'No tienes conteos asignados hoy.';
const ERROR_NOTE = 'No pudimos cargar tus conteos asignados.';
const NO_CATALOGUE_NOTE = 'Este plan aún no tiene catálogo asociado.';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; plans: PlanSummary[] };

function subtitle(count: number): string {
  return count === 1 ? 'Tienes 1 conteo asignado hoy.' : `Tienes ${count} conteos asignados hoy.`;
}

export function PlansScreen({
  dispatch,
  operatorId,
  operatorName = 'Pablo',
  loadPlans = realFetchPlans,
}: PlansScreenProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setLoad({ kind: 'loading' });
    loadPlans(operatorId, { signal: controller.signal })
      .then((plans) => {
        if (live) setLoad({ kind: 'ready', plans });
      })
      .catch(() => {
        // An empty list here would claim the operator has no assignments, which
        // is a different fact from "we could not ask". Never conflate the two.
        if (live) setLoad({ kind: 'error' });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [loadPlans, operatorId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const plans = load.kind === 'ready' ? load.plans : [];

  return (
    <section class="plans" aria-labelledby="plans-title">
      <header class="plans__header">
        <p class="plans__eyebrow">Colsubsidio · Hotelería</p>
        <h1 id="plans-title" class="plans__title">
          Hola, {operatorName}
        </h1>
        {load.kind === 'ready' ? <p class="plans__sub">{subtitle(plans.length)}</p> : null}
      </header>

      {load.kind === 'loading' ? (
        <p class="plans__loading" role="status">
          {LOADING_NOTE}
        </p>
      ) : null}

      {load.kind === 'error' ? (
        <div class="plans__error" role="alert">
          <p>{ERROR_NOTE}</p>
          <button type="button" class="btn btn--ghost" onClick={retry}>
            Reintentar
          </button>
        </div>
      ) : null}

      {load.kind === 'ready' && plans.length === 0 ? <p class="plans__empty">{EMPTY_NOTE}</p> : null}

      <ul class="plans__list">
        {plans.map((plan) => {
          const startable = plan.catalogueId !== null;
          return (
            <li key={plan.id} class="plan-card">
              <h2 class="plan-card__title">{plan.name}</h2>
              {/* The honest sub-line: the literal id the match request carries. */}
              <p class="plan-card__id mono">{plan.catalogueId ?? '—'}</p>
              {startable ? null : <p class="plan-card__detail">{NO_CATALOGUE_NOTE}</p>}
              <button
                type="button"
                class="btn btn--primary"
                aria-label={`Iniciar conteo · ${plan.name}`}
                disabled={!startable}
                onClick={() => {
                  if (plan.catalogueId === null) return;
                  dispatch({
                    type: 'PLAN_STARTED',
                    catalogueId: plan.catalogueId,
                    planId: plan.id,
                    operatorId,
                    warehouseId: plan.warehouseId,
                  });
                }}
              >
                <span class="msr" aria-hidden="true">
                  mic
                </span>
                Iniciar conteo
              </button>
            </li>
          );
        })}
      </ul>

      <footer class="plans__footer">
        <p>{FOOTER_NOTE}</p>
      </footer>
    </section>
  );
}

export default PlansScreen;

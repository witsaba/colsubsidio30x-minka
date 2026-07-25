/**
 * S2 «Planes asignados» — plan selection over the 8 REAL matcher catalogues
 * (REQ-OCF-8, RF-11 limited).
 *
 * The prototype lists invented warehouses ("Cocina Principal", "Cafetería
 * Primer Piso"). The shipped matcher serves 8 stock tables and the source file
 * has no key joining a bodega to a catalogue, so this screen renders the real
 * `catalogue_id`s — every card carries the id that will actually travel on the
 * match request — and states the limitation verbatim instead of faking it.
 *
 * Blind counting binds this screen too (RF-18): a plan card shows the article
 * count of the catalogue, never a theoretical stock value.
 */
import { CATALOGUES, CATALOGUE_IDS, RF11_LIMITATION_NOTE } from '../../lib/catalogues';
import type { SessionEvent } from '../../lib/session/types';

export interface PlansScreenProps {
  dispatch: (event: SessionEvent) => void;
  /** Default 'Pablo' matches the design's demo operator. */
  operatorName?: string;
  /** The operator sees ONLY assigned plans. Defaults to all 8 catalogues. */
  assignedCatalogueIds?: readonly string[];
}

const FOOTER_NOTE = 'Solo ves las bodegas que te asignaron. El conteo es ciego.';

export function PlansScreen({
  dispatch,
  operatorName = 'Pablo',
  assignedCatalogueIds = CATALOGUE_IDS,
}: PlansScreenProps) {
  const assigned = new Set(assignedCatalogueIds);
  const plans = CATALOGUES.filter((catalogue) => assigned.has(catalogue.catalogueId));

  return (
    <section class="plans" aria-labelledby="plans-title">
      <header class="plans__header">
        <p class="plans__eyebrow">Colsubsidio · Hotelería</p>
        <h1 id="plans-title" class="plans__title">
          Hola, {operatorName}
        </h1>
        <p class="plans__sub">
          {plans.length === 1
            ? 'Tienes 1 conteo asignado hoy.'
            : `Tienes ${plans.length} conteos asignados hoy.`}
        </p>
      </header>

      <ul class="plans__list">
        {plans.map((plan) => (
          <li key={plan.catalogueId} class="plan-card">
            <h2 class="plan-card__title">{plan.label}</h2>
            {/* The honest sub-line: the literal id the match request will carry. */}
            <p class="plan-card__id mono">{plan.catalogueId}</p>
            <p class="plan-card__detail">{plan.rows} artículos en el catálogo</p>
            <button
              type="button"
              class="btn btn--primary"
              aria-label={`Iniciar conteo · ${plan.label}`}
              onClick={() =>
                dispatch({ type: 'PLAN_STARTED', catalogueId: plan.catalogueId })
              }
            >
              <span class="msr" aria-hidden="true">
                mic
              </span>
              Iniciar conteo
            </button>
          </li>
        ))}
      </ul>

      <footer class="plans__footer">
        <p>{FOOTER_NOTE}</p>
        <p class="plans__limitation">{RF11_LIMITATION_NOTE}</p>
      </footer>
    </section>
  );
}

export default PlansScreen;

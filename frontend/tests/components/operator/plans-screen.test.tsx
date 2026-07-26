/**
 * S2 plans screen over the operator's ASSIGNED AUDIT PLANS (REQ-OCF-8,
 * REQ-SDA-3, RF-11, RF-07).
 *
 * SUPERSEDES the original T16 contract. That version listed `lib/catalogues.ts`
 * — the 8 real matcher catalogues — because no plan table was reachable from the
 * browser yet, and it stated the RF-11 limitation on screen instead of faking a
 * mapping. `supabase-operational-integration` closes exactly that gap: the
 * modified REQ-OCF-8 now requires the list to come from `audit_plans` joined
 * through `plan_operators`, so a raw catalogue listing is no longer merely
 * limited, it is the wrong source. The assertions below are rewritten against
 * the new requirement rather than deleted.
 *
 * The fetch is a prop seam, so nothing here touches the network.
 */
import { fireEvent, render, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { PlansScreen } from '../../../src/components/operator/PlansScreen';
import type { PlanSummary } from '../../../src/lib/api/operational';
import type { SessionEvent } from '../../../src/lib/session/types';

const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

const FUENTES: PlanSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Restaurante Fuentes · AyB',
  warehouseId: '28f1c715-4c42-4920-bf4b-6127e40ce11f',
  catalogueId: 'STOCK_RESTAURANTE_FUENTES_AYB',
};

const ZOOLOGICO: PlanSummary = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Zoológico · AyB',
  warehouseId: 'aa000000-0000-4000-8000-000000000001',
  catalogueId: 'ZOOLOGICO',
};

function renderPlans(loadPlans: () => Promise<PlanSummary[]>) {
  const dispatch = vi.fn<(event: SessionEvent) => void>();
  const load = vi.fn(loadPlans);
  const view = render(
    <PlansScreen dispatch={dispatch} operatorId={OPERATOR_ID} loadPlans={load} />,
  );
  return { ...view, dispatch, load };
}

const startButtons = (view: { queryAllByRole: (r: string, o: object) => HTMLElement[] }) =>
  view.queryAllByRole('button', { name: /^Iniciar conteo · / });

describe('PlansScreen — the list comes from the operator’s plans (REQ-SDA-3)', () => {
  it('asks the fetcher for THIS operator’s plans and renders each one by name', async () => {
    const view = renderPlans(async () => [FUENTES, ZOOLOGICO]);

    expect(view.load).toHaveBeenCalledWith(OPERATOR_ID, expect.anything());

    await waitFor(() => expect(startButtons(view)).toHaveLength(2));
    expect(view.getByText('Restaurante Fuentes · AyB')).toBeTruthy();
    expect(view.getByText('Zoológico · AyB')).toBeTruthy();
  });

  it('shows a loading state while the fetch is in flight', async () => {
    let settle = (plans: PlanSummary[]): void => void plans;
    const view = renderPlans(
      () => new Promise<PlanSummary[]>((resolve) => {
        settle = resolve;
      }),
    );

    expect(view.getByRole('status').textContent).toContain('Cargando tus conteos asignados');
    expect(startButtons(view)).toHaveLength(0);

    settle([FUENTES]);
    await waitFor(() => expect(startButtons(view)).toHaveLength(1));
    expect(view.queryByRole('status')).toBeNull();
  });

  it('renders the honest empty state for an operator with no assignments (RF-07)', async () => {
    // The emptiness comes from the route's own `[]` — the operator is in no
    // `plan_operators` row — and NOT from a screen that failed to render.
    const view = renderPlans(async () => []);

    await waitFor(() => expect(view.getByText('No tienes conteos asignados hoy.')).toBeTruthy());
    expect(startButtons(view)).toHaveLength(0);
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('never lists a plan the fetcher did not return', async () => {
    const view = renderPlans(async () => [ZOOLOGICO]);

    await waitFor(() => expect(startButtons(view)).toHaveLength(1));
    expect(view.getByText('Zoológico · AyB')).toBeTruthy();
    expect(view.queryByText('Restaurante Fuentes · AyB')).toBeNull();
  });
});

describe('PlansScreen — a failed fetch is retryable, never silent', () => {
  it('shows an error with a retry instead of an empty list', async () => {
    const view = renderPlans(async () => {
      throw new Error('proxy_unreachable');
    });

    const alert = await view.findByRole('alert');
    expect(alert.textContent).toContain('No pudimos cargar tus conteos asignados.');
    // The empty state would be a lie here: we do not know that there are none.
    expect(view.queryByText('No tienes conteos asignados hoy.')).toBeNull();
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('«Reintentar» re-fetches and renders the plans on the second attempt', async () => {
    let attempts = 0;
    const view = renderPlans(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('proxy_unreachable');
      return [FUENTES];
    });

    const alert = await view.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(startButtons(view)).toHaveLength(1));
    expect(view.queryByRole('alert')).toBeNull();
    expect(view.load).toHaveBeenCalledTimes(2);
  });
});

describe('PlansScreen — selection carries the plan scope (REQ-OCF-8, RF-07)', () => {
  it('dispatches PLAN_STARTED with the plan, operator, warehouse and catalogue', async () => {
    const view = renderPlans(async () => [FUENTES, ZOOLOGICO]);
    await waitFor(() => expect(startButtons(view)).toHaveLength(2));

    fireEvent.click(view.getByRole('button', { name: 'Iniciar conteo · Restaurante Fuentes · AyB' }));

    expect(view.dispatch).toHaveBeenCalledWith({
      type: 'PLAN_STARTED',
      catalogueId: 'STOCK_RESTAURANTE_FUENTES_AYB',
      planId: FUENTES.id,
      operatorId: OPERATOR_ID,
      warehouseId: FUENTES.warehouseId,
    });
  });

  it('dispatches the OTHER plan’s ids for the other card', async () => {
    const view = renderPlans(async () => [FUENTES, ZOOLOGICO]);
    await waitFor(() => expect(startButtons(view)).toHaveLength(2));

    fireEvent.click(view.getByRole('button', { name: 'Iniciar conteo · Zoológico · AyB' }));

    expect(view.dispatch).toHaveBeenCalledWith({
      type: 'PLAN_STARTED',
      catalogueId: 'ZOOLOGICO',
      planId: ZOOLOGICO.id,
      operatorId: OPERATOR_ID,
      warehouseId: ZOOLOGICO.warehouseId,
    });
  });

  it('refuses to start a plan with no catalogue bound to it, and says why', async () => {
    // A plan without `catalogue_id` cannot build a match request at all, so
    // starting it would strand the operator at the first dictation.
    const view = renderPlans(async () => [{ ...FUENTES, catalogueId: null }]);

    await waitFor(() => expect(startButtons(view)).toHaveLength(1));
    const button = view.getByRole('button', {
      name: 'Iniciar conteo · Restaurante Fuentes · AyB',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(view.getByText('Este plan aún no tiene catálogo asociado.')).toBeTruthy();

    fireEvent.click(button);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe('PlansScreen — blind counting (RF-18)', () => {
  it('shows no theoretical stock quantity on any plan card', async () => {
    const view = renderPlans(async () => [FUENTES, ZOOLOGICO]);
    await waitFor(() => expect(startButtons(view)).toHaveLength(2));

    expect(view.container.textContent).not.toMatch(/stock del sistema:/i);
    expect(view.container.textContent).not.toMatch(/te[oó]rico/i);
    expect(view.container.textContent).toContain(
      'Solo ves las bodegas que te asignaron. El conteo es ciego.',
    );
  });
});

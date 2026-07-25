/**
 * T16 RED — S2 plans screen over the 8 REAL matcher catalogues (REQ-OCF-8).
 *
 * The design invents warehouse names; the product has 8 stock tables and no
 * bodega->catalogue key (RF-11). The screen therefore renders the real ids with
 * their Spanish labels and states the limitation instead of faking it.
 */
import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { PlansScreen } from '../../../src/components/operator/PlansScreen';
import { CATALOGUES, RF11_LIMITATION_NOTE } from '../../../src/lib/catalogues';
import type { SessionEvent } from '../../../src/lib/session/types';

function renderPlans(assignedCatalogueIds?: readonly string[]) {
  const dispatch = vi.fn<(event: SessionEvent) => void>();
  const view = render(
    <PlansScreen dispatch={dispatch} {...(assignedCatalogueIds ? { assignedCatalogueIds } : {})} />,
  );
  return { ...view, dispatch };
}

describe('PlansScreen — the 8 real catalogues (REQ-OCF-8)', () => {
  it('renders one startable plan per real catalogue, with its Spanish label', () => {
    const { getAllByRole, getByText } = renderPlans();

    expect(getAllByRole('button', { name: /^Iniciar conteo · / })).toHaveLength(8);
    for (const catalogue of CATALOGUES) {
      expect(getByText(catalogue.label)).toBeTruthy();
    }
  });

  it('renders the real catalogue_id verbatim, never an invented bodega key', () => {
    const { container } = renderPlans();

    expect(container.textContent).toContain('stock_restaurante_fuentes_ayb');
    expect(container.textContent).toContain('zoologico_suministros');
  });

  it('states the RF-11 limitation instead of faking a bodega mapping', () => {
    const { container } = renderPlans();

    expect(container.textContent).toContain(RF11_LIMITATION_NOTE);
  });

  it('dispatches PLAN_STARTED carrying that plan’s real catalogue_id', () => {
    const { getByRole, dispatch } = renderPlans();

    fireEvent.click(getByRole('button', { name: 'Iniciar conteo · Zoológico · AyB' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'PLAN_STARTED', catalogueId: 'zoologico' });
  });

  it('dispatches a different catalogue_id for a different card', () => {
    const { getByRole, dispatch } = renderPlans();

    fireEvent.click(getByRole('button', { name: 'Iniciar conteo · Almacén · Suministros' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'PLAN_STARTED',
      catalogueId: 'stock_almacen_suministros',
    });
  });
});

describe('PlansScreen — only assigned plans are shown', () => {
  it('renders exactly the assigned subset and hides the rest', () => {
    const { getAllByRole, getByText, queryByText } = renderPlans(['zoologico', 'stock_almacen_ayb']);

    expect(getAllByRole('button', { name: /^Iniciar conteo · / })).toHaveLength(2);
    expect(getByText('Zoológico · AyB')).toBeTruthy();
    expect(getByText('Almacén · AyB')).toBeTruthy();
    expect(queryByText('Restaurante Fuentes · AyB')).toBeNull();
  });

  it('renders the blind-counting footer verbatim', () => {
    const { container } = renderPlans(['zoologico']);

    expect(container.textContent).toContain(
      'Solo ves las bodegas que te asignaron. El conteo es ciego.',
    );
  });
});

describe('PlansScreen — blind counting (RF-18)', () => {
  it('shows no theoretical stock quantity on any plan card', () => {
    const { container } = renderPlans();

    expect(container.textContent).not.toMatch(/stock del sistema:/i);
    expect(container.textContent).not.toMatch(/te[oó]rico/i);
  });
});

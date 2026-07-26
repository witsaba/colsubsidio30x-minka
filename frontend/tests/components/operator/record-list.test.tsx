/**
 * T17 RED — the record list (REQ-OCF-2, REQ-OCF-4, REQ-OCF-7, REQ-OCF-11).
 *
 * Every null the real catalogue actually contains is exercised here: ~18.4% of
 * `nr_articulo` are NULL, and `unidad_display` is null whenever the matcher
 * cannot resolve a unit. Neither may be coerced into a plausible-looking value.
 */
import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { RecordList } from '../../../src/components/operator/RecordList';
import type { CountRecord, SessionEvent } from '../../../src/lib/session/types';

const AT = Date.UTC(2026, 6, 25, 13, 12, 0);

function record(patch: Partial<CountRecord> = {}): CountRecord {
  return {
    id: 'rec-1',
    quantity: 3,
    unitDisplay: 'kilos',
    articulo: 'LECHUGA BATAVIA',
    nrArticulo: '100221',
    spokenName: 'tres kilos de lechuga',
    state: 'ok',
    createdAt: AT,
    ...patch,
  };
}

function renderList(records: readonly CountRecord[]) {
  const dispatch = vi.fn<(event: SessionEvent) => void>();
  const view = render(<RecordList records={records} dispatch={dispatch} />);
  return { ...view, dispatch };
}

describe('RecordList — row content', () => {
  it('renders the quantity, the unit and the article name', () => {
    const { getByText } = renderList([record()]);

    expect(getByText('3')).toBeTruthy();
    expect(getByText('kilos')).toBeTruthy();
    expect(getByText('LECHUGA BATAVIA')).toBeTruthy();
  });

  it('renders the SKU line with the article code', () => {
    const { container } = renderList([record()]);

    expect(container.textContent).toContain('100221');
  });

  it('renders every record it is given', () => {
    const { getAllByRole } = renderList([
      record({ id: 'a' }),
      record({ id: 'b', articulo: 'ARROZ BLANCO GRANO LARGO' }),
      record({ id: 'c', articulo: 'ACEITE DE OLIVA EXTRA VIRGEN' }),
    ]);

    expect(getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('RecordList — units render from unidad_display only (REQ-OCF-7)', () => {
  it('never renders the English canonical unit, even when it rides along', () => {
    const polluted = { ...record(), unidad: 'Kilogram' } as unknown as CountRecord;
    const { container } = renderList([polluted]);

    expect(container.textContent).toContain('kilos');
    expect(container.textContent).not.toContain('Kilogram');
    expect(container.textContent).not.toContain('Liter');
    expect(container.textContent).not.toContain('Portion');
  });

  it('renders no unit text at all when unidad_display is null', () => {
    const { container, queryByTestId } = renderList([record({ unitDisplay: null })]);

    expect(queryByTestId('record-unit')).toBeNull();
    expect(container.textContent).not.toContain('null');
    expect(container.textContent).toContain('LECHUGA BATAVIA');
  });

  it('renders the SKU line without a code when nr_articulo is null', () => {
    const { getByTestId, container } = renderList([record({ nrArticulo: null })]);

    expect(container.textContent).not.toContain('null');
    expect(container.textContent).not.toContain('undefined');
    expect(getByTestId('record-meta').textContent).not.toContain('100221');
    expect(getByTestId('record-meta').textContent).toContain('Sin código');
  });
});

describe('RecordList — record state (REQ-OCF-5, REQ-OCF-11)', () => {
  it('labels a settled record as confirmed', () => {
    const { getByLabelText } = renderList([record({ state: 'ok' })]);

    expect(getByLabelText('Registro confirmado')).toBeTruthy();
  });

  it('labels an open anomaly as pending resolution', () => {
    const { getByLabelText } = renderList([record({ state: 'anom_open' })]);

    expect(getByLabelText('Registro señalado sin resolver')).toBeTruthy();
  });

  it('describes `sync` as an in-session pending upload, never as offline support', () => {
    const { getByLabelText, container } = renderList([record({ state: 'sync' })]);

    expect(getByLabelText('Pendiente de subir')).toBeTruthy();
    expect(container.textContent).not.toContain('Funciona sin señal');
    expect(container.textContent).not.toMatch(/sin conexi[oó]n/i);
  });
});

describe('RecordList — deletion is touch-only (REQ-OCF-4 / RF-20, RF-21)', () => {
  it('dispatches RECORD_DELETED for the row the operator touched', () => {
    const { getByRole, dispatch } = renderList([
      record({ id: 'rec-a', articulo: 'LECHUGA BATAVIA' }),
      record({ id: 'rec-b', articulo: 'ARROZ BLANCO GRANO LARGO' }),
    ]);

    fireEvent.click(getByRole('button', { name: 'Eliminar registro · ARROZ BLANCO GRANO LARGO' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'RECORD_DELETED', id: 'rec-b' });
  });

  it('offers no edit control at all — voice creates, touch deletes', () => {
    const { queryByRole } = renderList([record()]);

    expect(queryByRole('button', { name: /Editar/ })).toBeNull();
    expect(queryByRole('textbox')).toBeNull();
  });
});

describe('RecordList — blind counting (REQ-OCF-2 / RF-18)', () => {
  it('renders no system stock value even when one is attached to the record', () => {
    const leaky = { ...record(), systemQty: 999, teorico: 777 } as unknown as CountRecord;
    const { container } = renderList([leaky]);

    expect(container.textContent).not.toContain('999');
    expect(container.textContent).not.toContain('777');
  });
});

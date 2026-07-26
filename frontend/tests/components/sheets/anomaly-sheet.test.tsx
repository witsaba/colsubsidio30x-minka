/**
 * T19 RED — the S6 anomaly sheet (REQ-OCF-5, RF-28, RF-29).
 *
 * The anomaly sheet is what keeps the microphone blocked, so its structural
 * contract is as important as its copy: exactly two resolutions, and no legal
 * way out of the sheet other than choosing one of them.
 */
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, test, vi } from 'vitest';

import type { Anomaly } from '../../../src/lib/anomaly/engine';
import type { Candidate, MatchResponse } from '../../../src/lib/api/types';
import type { ExtractedItem } from '../../../src/lib/extraction/adapter';
import type { ConfirmableItem } from '../../../src/lib/pipeline';
import type { SessionState } from '../../../src/lib/session/types';
import { blocked, initialSessionState } from '../../../src/lib/session/reducer';
import { AnomalySheet } from '../../../src/components/operator/AnomalySheet';

function confirmable(
  extracted: ExtractedItem,
  picked: Partial<Candidate>,
): ConfirmableItem {
  const candidate: Candidate = {
    nr_articulo: 'MP-10077',
    articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
    unidad: 'Liter',
    unidad_display: 'litros',
    score: 0.91,
    ...picked,
  };
  const match: MatchResponse = {
    status: 'matched',
    candidates: [candidate],
    top_score: 0.91,
    margin: 0.3,
    request_id: 'req-anom',
  };
  return { extracted, match, picked: candidate };
}

/* The two design-contract fixtures, verbatim. */

const UNIDAD_ITEM = confirmable(
  { quantity: 900, unit: 'gramos', spokenName: 'aceite de oliva extra virgen' },
  {},
);

const UNIDAD_ANOMALY: Anomaly = {
  kind: 'unidad',
  title: 'Revisa la unidad antes de seguir',
  reason:
    'Este artículo se cuenta en litros (L), no en gramos. 900 g no corresponde a esta bodega.',
  hint: 'Escuché “novecientos” y lo escribí 900 · regla de unidad RF-26(b)',
};

const CANTIDAD_ITEM = confirmable(
  { quantity: 305, unit: 'unidades', spokenName: 'gaseosa personal' },
  {
    nr_articulo: 'MP-10505',
    articulo: 'GASEOSA PERSONAL 400ML',
    unidad: 'Unidad',
    unidad_display: 'unidades',
  },
);

const CANTIDAD_ANOMALY: Anomaly = {
  kind: 'cantidad',
  title: 'Cantidad fuera de lo habitual',
  reason: 'Aquí normalmente se cuentan entre 20 y 40 unidades. 305 es 10 veces lo esperado.',
  hint: 'Si de verdad hay 305, deja la nota y el auditor la revisa · RF-26(c)',
};

describe('AnomalySheet — S6', () => {
  test('renders the unidad fixture verbatim', () => {
    render(
      <AnomalySheet item={UNIDAD_ITEM} anomaly={UNIDAD_ANOMALY} onRedictate={vi.fn()} onKeepNoted={vi.fn()} />,
    );

    expect(screen.getByText('Alerta de anomalía')).toBeTruthy();
    expect(screen.getByTestId('anomaly-title').textContent).toBe('Revisa la unidad antes de seguir');
    expect(screen.getByTestId('anomaly-qty').textContent).toBe('900');
    expect(screen.getByTestId('anomaly-unit').textContent).toBe('litros');
    expect(screen.getByText('ACEITE DE OLIVA EXTRA VIRGEN 500ML')).toBeTruthy();
    expect(screen.getByTestId('anomaly-sku').textContent).toBe('MP-10077');
    expect(screen.getByTestId('anomaly-reason').textContent).toBe(UNIDAD_ANOMALY.reason);
    expect(screen.getByTestId('anomaly-hint').textContent).toBe(UNIDAD_ANOMALY.hint);
  });

  test('renders the cantidad fixture verbatim', () => {
    render(
      <AnomalySheet item={CANTIDAD_ITEM} anomaly={CANTIDAD_ANOMALY} onRedictate={vi.fn()} onKeepNoted={vi.fn()} />,
    );

    expect(screen.getByTestId('anomaly-title').textContent).toBe('Cantidad fuera de lo habitual');
    expect(screen.getByTestId('anomaly-qty').textContent).toBe('305');
    expect(screen.getByTestId('anomaly-unit').textContent).toBe('unidades');
    expect(screen.getByTestId('anomaly-sku').textContent).toBe('MP-10505');
    expect(screen.getByTestId('anomaly-reason').textContent).toBe(CANTIDAD_ANOMALY.reason);
    expect(screen.getByTestId('anomaly-hint').textContent).toBe(CANTIDAD_ANOMALY.hint);
  });

  test('carries the orange flag state from the token layer, never a hardcoded hex', () => {
    render(
      <AnomalySheet item={UNIDAD_ITEM} anomaly={UNIDAD_ANOMALY} onRedictate={vi.fn()} onKeepNoted={vi.fn()} />,
    );

    const card = screen.getByTestId('anomaly-card');
    expect(card.getAttribute('style')).toContain('var(--warn-border-2)');
    expect(card.getAttribute('style')).toContain('var(--warn-bg-2)');
    expect(screen.getByTestId('anomaly-qty').getAttribute('style')).toContain('var(--warn)');
    expect(screen.getByTestId('anomaly-icon').textContent).toBe('error');
  });

  test('offers exactly the two designed resolutions', () => {
    const onRedictate = vi.fn();
    const onKeepNoted = vi.fn();
    render(
      <AnomalySheet item={UNIDAD_ITEM} anomaly={UNIDAD_ANOMALY} onRedictate={onRedictate} onKeepNoted={onKeepNoted} />,
    );

    const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Eliminar y volver a dictar', 'Es correcto · dejar nota al auditor']);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar y volver a dictar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Es correcto · dejar nota al auditor' }));
    expect(onRedictate).toHaveBeenCalledTimes(1);
    expect(onKeepNoted).toHaveBeenCalledTimes(1);
  });

  test('cannot be dismissed — this is what keeps the mic blocked (REQ-OCF-5)', () => {
    render(
      <AnomalySheet item={UNIDAD_ITEM} anomaly={UNIDAD_ANOMALY} onRedictate={vi.fn()} onKeepNoted={vi.fn()} />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('anomaly-sheet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cerrar|cancelar|ninguno/i })).toBeNull();

    // And while that overlay is open the reducer's derived guard is blocking.
    const state: SessionState = {
      ...initialSessionState,
      screen: 'count',
      overlay: { kind: 'anomaly', item: UNIDAD_ITEM, anomaly: UNIDAD_ANOMALY, queue: [] },
    };
    expect(blocked(state)).toBe(true);
  });

  test('is a labelled modal dialog with focus moved inside', () => {
    render(
      <AnomalySheet item={UNIDAD_ITEM} anomaly={UNIDAD_ANOMALY} onRedictate={vi.fn()} onKeepNoted={vi.fn()} />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Eliminar y volver a dictar' }),
    );
  });

  test('a null unidad_display renders no unit and never the English canonical unit', () => {
    render(
      <AnomalySheet
        item={confirmable(UNIDAD_ITEM.extracted, { unidad_display: null, unidad: 'Liter' })}
        anomaly={UNIDAD_ANOMALY}
        onRedictate={vi.fn()}
        onKeepNoted={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('anomaly-unit')).toBeNull();
    expect(document.body.textContent).not.toContain('Liter');
  });

  test('a null nr_articulo renders the SKU line without a code', () => {
    render(
      <AnomalySheet
        item={confirmable(UNIDAD_ITEM.extracted, { nr_articulo: null })}
        anomaly={UNIDAD_ANOMALY}
        onRedictate={vi.fn()}
        onKeepNoted={vi.fn()}
      />,
    );

    expect(screen.getByTestId('anomaly-sku').textContent).toBe('Sin código');
  });
});

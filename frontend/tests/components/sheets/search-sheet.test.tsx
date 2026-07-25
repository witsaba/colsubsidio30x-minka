/**
 * T19 RED — the S7 manual-search sheet (REQ-OCF-6, RF-15, RF-16, D8).
 *
 * D8: ONE sheet serves BOTH `no_match` and `ambiguous`. The designers never drew
 * the ambiguous state, so `ambiguous` reuses this surface with adjusted copy —
 * a confident wrong match is worse than asking.
 *
 * The design's "search field" is a `<span>`; a real accessible `<input>` wired
 * to a debounced re-query is authored here.
 */
import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Candidate } from '../../../src/lib/api/types';
import type { ExtractedItem } from '../../../src/lib/extraction/adapter';
import { MATCH_MAX_CANDIDATES, SearchSheet } from '../../../src/components/operator/SearchSheet';

const ITEM: ExtractedItem = {
  quantity: 5,
  unit: null,
  spokenName: 'tabla para picar blanca',
};

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    nr_articulo: 'DT-30112',
    articulo: 'TABLA ACRILICA PICAR BLANCO 50X38CM FB',
    unidad: 'Unidad',
    unidad_display: 'unidades',
    score: 0.62,
    ...over,
  };
}

const THREE: Candidate[] = [
  candidate(),
  candidate({ nr_articulo: 'DT-30113', articulo: 'TABLA ACRILICA PICAR BLANCO 30X20CM', score: 0.6 }),
  candidate({ nr_articulo: 'DT-30120', articulo: 'TABLA MADERA PICAR NATURAL 40X30CM', score: 0.57 }),
];

const QUERY = 'tabla para picar blanca';

function base() {
  return {
    item: ITEM,
    query: QUERY,
    candidates: THREE,
    onQueryChange: vi.fn(),
    onPick: vi.fn(),
    onDismiss: vi.fn(),
  };
}

describe('SearchSheet — S7', () => {
  test('no_match keeps the original design copy verbatim', () => {
    render(<SearchSheet mode="no_match" {...base()} />);

    expect(screen.getByText('Sin coincidencia exacta')).toBeTruthy();
    expect(screen.getByTestId('search-prompt').textContent).toBe(
      `No encontré “${QUERY}” en esta bodega. ¿Cuál es?`,
    );
  });

  test('ambiguous reuses the SAME sheet with adjusted copy (D8)', () => {
    render(<SearchSheet mode="ambiguous" {...base()} />);

    // Same surface — the sheet itself is identical.
    expect(screen.getByTestId('search-sheet')).toBeTruthy();
    expect(screen.getByText('Encontré varias opciones')).toBeTruthy();
    expect(screen.getByTestId('search-prompt').textContent).toBe('¿Cuál de estos es?');
    expect(document.body.textContent).not.toContain('Sin coincidencia exacta');
    expect(screen.getAllByTestId('search-candidate')).toHaveLength(3);
  });

  test('renders up to MATCH_MAX_CANDIDATES = 5, not the design’s 3', () => {
    expect(MATCH_MAX_CANDIDATES).toBe(5);

    const seven = Array.from({ length: 7 }, (_, i) =>
      candidate({ nr_articulo: `DT-3011${i}`, articulo: `TABLA ${i}` }),
    );
    render(<SearchSheet mode="ambiguous" {...base()} candidates={seven} />);

    expect(screen.getAllByTestId('search-candidate')).toHaveLength(5);
    expect(screen.queryByText('TABLA 5')).toBeNull();
  });

  test('each candidate shows its name and “SKU · se cuenta en {unit}”', () => {
    render(<SearchSheet mode="no_match" {...base()} />);

    const metas = screen.getAllByTestId('search-candidate-meta').map((n) => n.textContent);
    expect(metas[0]).toBe('DT-30112 · se cuenta en unidades');
  });

  test('nulls render honestly: no code, no unit, never the English canonical unit', () => {
    render(
      <SearchSheet
        mode="no_match"
        {...base()}
        candidates={[candidate({ nr_articulo: null, unidad_display: null, unidad: 'Kilogram' })]}
      />,
    );

    expect(screen.getByTestId('search-candidate-meta').textContent).toBe('Sin código');
    expect(document.body.textContent).not.toContain('Kilogram');
    expect(document.body.textContent).not.toContain('se cuenta en');
  });

  test('picking a candidate reports it back so the item becomes confirmable', () => {
    const props = base();
    render(<SearchSheet mode="no_match" {...props} />);

    fireEvent.click(screen.getAllByTestId('search-candidate')[1] as HTMLElement);
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onPick).toHaveBeenCalledWith(THREE[1]);
  });

  test('“Ninguno · volver a dictar” drops the item', () => {
    const props = base();
    render(<SearchSheet mode="no_match" {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ninguno · volver a dictar' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  test('Escape dismisses — here the dismissal is legal', () => {
    const props = base();
    render(<SearchSheet mode="no_match" {...props} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  test('is a labelled modal dialog', () => {
    render(<SearchSheet mode="no_match" {...base()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  describe('the authored real <input> (the design has only a <span>)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('is a genuine, labelled, focused text input seeded with the query', () => {
      render(<SearchSheet mode="no_match" {...base()} />);

      const input = screen.getByLabelText('Buscar el artículo en esta bodega') as HTMLInputElement;
      expect(input.tagName).toBe('INPUT');
      expect(input.type).toBe('search');
      expect(input.value).toBe(QUERY);
      expect(document.activeElement).toBe(input);
    });

    test('re-queries only after the debounce window, once per pause', () => {
      const props = base();
      render(<SearchSheet mode="no_match" {...props} debounceMs={250} />);

      const input = screen.getByLabelText('Buscar el artículo en esta bodega') as HTMLInputElement;

      fireEvent.input(input, { target: { value: 'tabla acri' } });
      fireEvent.input(input, { target: { value: 'tabla acrilica' } });
      expect(props.onQueryChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(250);
      expect(props.onQueryChange).toHaveBeenCalledTimes(1);
      expect(props.onQueryChange).toHaveBeenCalledWith('tabla acrilica');
    });

    test('never re-queries with the value it was seeded with', () => {
      const props = base();
      render(<SearchSheet mode="no_match" {...props} debounceMs={250} />);

      vi.advanceTimersByTime(1000);
      expect(props.onQueryChange).not.toHaveBeenCalled();
    });
  });
});

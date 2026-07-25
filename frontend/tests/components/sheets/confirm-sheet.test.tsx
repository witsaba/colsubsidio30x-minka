/**
 * T18 RED — the S5 confirm sheet (REQ-OCF-3, REQ-OCF-7, RF-14, RF-33, QA-22).
 *
 * Two invariants dominate this suite:
 *   1. Confirmation is yes/no ONLY and must reveal NO prior stock (blind count).
 *   2. Units render from `unidad_display` and nothing else; nulls render absent.
 */
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, test, vi } from 'vitest';

import type { Candidate, MatchResponse } from '../../../src/lib/api/types';
import type { ExtractedItem } from '../../../src/lib/extraction/adapter';
import type { ConfirmableItem } from '../../../src/lib/pipeline';
import { ConfirmSheet } from '../../../src/components/operator/ConfirmSheet';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    nr_articulo: '10221',
    articulo: 'LECHUGA BATAVIA',
    unidad: 'Kilogram',
    unidad_display: 'kg',
    score: 0.93,
    ...over,
  };
}

function matchResponse(over: Partial<MatchResponse> = {}): MatchResponse {
  return {
    status: 'matched',
    candidates: [candidate()],
    top_score: 0.93,
    margin: 0.4,
    request_id: 'req-1',
    ...over,
  };
}

function extracted(over: Partial<ExtractedItem> = {}): ExtractedItem {
  return { quantity: 3, unit: 'kilos', spokenName: 'lechuga batavia', ...over };
}

function item(over: Partial<ConfirmableItem> = {}): ConfirmableItem {
  return { extracted: extracted(), match: matchResponse(), picked: candidate(), ...over };
}

const THREE_ITEMS: ConfirmableItem[] = [
  item(),
  item({
    extracted: extracted({ quantity: 12, unit: 'botellas', spokenName: 'aceite vegetal' }),
    picked: candidate({ nr_articulo: '10038', articulo: 'ACEITE VEGETAL GIRASOL 3L', unidad: 'Unidad', unidad_display: 'unidades' }),
  }),
  item({
    extracted: extracted({ quantity: 2, unit: 'cajas', spokenName: 'tomate chonto' }),
    picked: candidate({ nr_articulo: '10190', articulo: 'TOMATE CHONTO X 10KG', unidad: 'Unidad', unidad_display: 'unidades' }),
  }),
];

const SCRIPT_1 =
  'tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto';

describe('ConfirmSheet — S5', () => {
  test('renders exactly one card per extracted item (RF-14 multi-item split)', () => {
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    expect(screen.getAllByTestId('confirm-item')).toHaveLength(3);
    expect(screen.getByText('LECHUGA BATAVIA')).toBeTruthy();
    expect(screen.getByText('ACEITE VEGETAL GIRASOL 3L')).toBeTruthy();
    expect(screen.getByText('TOMATE CHONTO X 10KG')).toBeTruthy();
  });

  test('the decision is yes/no ONLY — Repetir and Confirmar, nothing else', () => {
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Repetir', 'Confirmar']);
  });

  test('Confirmar and Repetir dispatch through their callbacks', () => {
    const onConfirm = vi.fn();
    const onRepeat = vi.fn();
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={onConfirm} onRepeat={onRepeat} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repetir' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onRepeat).toHaveBeenCalledTimes(1);
  });

  test('the exclusion ghost link appears only when the exclude flow is wired', () => {
    const onExclude = vi.fn();
    render(
      <ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} onExclude={onExclude} />,
    );

    const ghost = screen.getByRole('button', { name: 'Vi un producto vencido o roto' });
    // Still exactly two DECISION controls; the ghost lives outside the action row.
    const actions = screen.getByTestId('confirm-actions');
    expect(actions.querySelectorAll('button')).toHaveLength(2);

    fireEvent.click(ghost);
    expect(onExclude).toHaveBeenCalledTimes(1);
  });

  test('REQ-OCF-2/RF-33: no prior, theoretical or system stock is revealed', () => {
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/sistema|te[oó]rico|stock|saldo|existencias|diferencia/i);
    // Structural assertion: no element may be tagged as a system/stock value.
    expect(document.querySelectorAll('[data-testid*="system"], [data-testid*="stock"]')).toHaveLength(0);
  });

  test('REQ-OCF-7: units come from unidad_display only', () => {
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    const text = document.body.textContent ?? '';
    for (const canonical of ['Kilogram', 'Liter', 'Unidad', 'Portion']) {
      expect(text).not.toContain(canonical);
    }
    expect(screen.getAllByTestId('confirm-unit').map((n) => n.textContent)).toEqual([
      'kg',
      'unidades',
      'unidades',
    ]);
  });

  test('REQ-OCF-7: a null unidad_display renders no unit text at all', () => {
    render(
      <ConfirmSheet
        transcript={SCRIPT_1}
        items={[item({ picked: candidate({ unidad_display: null, unidad: 'Kilogram' }) })]}
        onConfirm={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('confirm-unit')).toBeNull();
    expect(document.body.textContent).not.toContain('Kilogram');
  });

  test('REQ-OCF-7: a null nr_articulo renders the SKU line without a code', () => {
    render(
      <ConfirmSheet
        transcript={SCRIPT_1}
        items={[item({ picked: candidate({ nr_articulo: null }) })]}
        onConfirm={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );

    const sku = screen.getByTestId('confirm-sku');
    expect(sku.textContent).toBe('Sin código');
    expect(sku.textContent).not.toContain('null');
  });

  test('an empty transcript omits the quoted block instead of rendering empty quotes', () => {
    // The reducer passes '' when the confirm sheet is reached from an anomaly or
    // a search resolution, where no transcript is carried by the overlay.
    render(<ConfirmSheet transcript="" items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    expect(screen.queryByTestId('confirm-transcript')).toBeNull();
    expect(document.body.textContent).not.toContain('“”');
    expect(screen.getAllByTestId('confirm-item')).toHaveLength(3);
  });

  test('a whitespace-only transcript is treated as absent too', () => {
    render(<ConfirmSheet transcript="   " items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);
    expect(screen.queryByTestId('confirm-transcript')).toBeNull();
  });

  test('is a labelled modal dialog and is NOT dismissible with Esc', () => {
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    // Confirmation is mandatory: there is no legal dismissal.
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
  });

  test('focus is trapped inside the sheet', () => {
    render(<ConfirmSheet transcript={SCRIPT_1} items={THREE_ITEMS} onConfirm={vi.fn()} onRepeat={vi.fn()} />);

    const repetir = screen.getByRole('button', { name: 'Repetir' });
    const confirmar = screen.getByRole('button', { name: 'Confirmar' });
    expect(document.activeElement).toBe(repetir);

    confirmar.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(repetir);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmar);
  });
});

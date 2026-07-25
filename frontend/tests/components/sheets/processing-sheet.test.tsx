/**
 * T18 RED — the S4 processing sheet (REQ-OCF-12, RNF-11).
 *
 * The prototype drove this overlay with a fixed 1700 ms timer. The real STT
 * worst case is `STT_TOTAL_DEADLINE_S = 45`, so the sheet must be driven by the
 * pipeline promise and must stay coherent for the full 45 s. A rejected promise
 * must land on an authored Spanish retry state, never on a hang.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/preact';
import { useEffect, useState } from 'preact/hooks';
import { describe, expect, test, vi } from 'vitest';

import { UiError } from '../../../src/lib/api/types';
import { ProcessingSheet } from '../../../src/components/operator/ProcessingSheet';

const TRANSCRIPT = 'tres kilos de lechuga batavia, doce botellas de aceite vegetal';

/** A promise whose settlement this test controls explicitly — no timers. */
function deferred<T>() {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/**
 * Stands in for `CountSession`: it holds the pipeline promise and swaps the
 * overlay only when that promise settles. Nothing here is time-based.
 */
function Harness({ promise }: { promise: Promise<unknown> }) {
  const [state, setState] = useState<'pending' | 'resolved' | 'failed'>('pending');
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    let live = true;
    promise.then(
      () => {
        if (live) setState('resolved');
      },
      (reason: unknown) => {
        if (!live) return;
        setError(reason as UiError);
        setState('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [promise]);

  if (state === 'resolved') return <div data-testid="routed">confirmar</div>;
  return <ProcessingSheet transcript={TRANSCRIPT} error={state === 'failed' ? error : null} onRetry={() => {}} />;
}

describe('ProcessingSheet — S4', () => {
  test('renders the design copy: eyebrow, quoted transcript and three pulsing dots', () => {
    render(<ProcessingSheet transcript={TRANSCRIPT} />);

    expect(screen.getByText('Escuché')).toBeTruthy();
    expect(screen.getByTestId('processing-transcript').textContent).toContain(TRANSCRIPT);
    expect(screen.getAllByTestId('processing-dot')).toHaveLength(3);
  });

  test('is a labelled modal dialog — the prototype has no aria at all', () => {
    render(<ProcessingSheet transcript={TRANSCRIPT} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  test('the honest default never claims a three-model consensus', () => {
    render(<ProcessingSheet transcript={TRANSCRIPT} />);

    // Module 2 (3-model consensus) does not exist (contract C4).
    expect(document.body.textContent).not.toContain('Verificando con tres modelos');
    expect(document.body.textContent).not.toContain('Consenso');
    expect(screen.getByTestId('processing-status').textContent).toBe(
      'Transcribiendo y buscando en el catálogo…',
    );
  });

  test('the design copy is available only behind the explicit mock flag', () => {
    render(<ProcessingSheet transcript={TRANSCRIPT} mockConsensus />);

    expect(screen.getByTestId('processing-status').textContent).toBe(
      'Verificando con tres modelos…',
    );
  });

  test('the transcript block is omitted while STT has not returned anything yet', () => {
    render(<ProcessingSheet transcript={null} />);

    expect(screen.queryByTestId('processing-transcript')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('stays visible until the injected promise resolves — not on a timer', async () => {
    const d = deferred<void>();
    render(<Harness promise={d.promise} />);

    expect(screen.getByTestId('processing-sheet')).toBeTruthy();

    d.resolve();
    await screen.findByTestId('routed');

    expect(screen.queryByTestId('processing-sheet')).toBeNull();
  });

  test('survives the 45 s STT worst case without self-dismissing', () => {
    vi.useFakeTimers();
    try {
      render(<ProcessingSheet transcript={TRANSCRIPT} />);
      // The prototype would have closed at 1700 ms.
      vi.advanceTimersByTime(45_000);
      expect(screen.getByTestId('processing-sheet')).toBeTruthy();
      expect(screen.queryByTestId('processing-error')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('the real path contains no 1700 ms timer', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../src/components/operator/ProcessingSheet.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/1700/);
    expect(source).not.toMatch(/setTimeout|setInterval/);
  });

  test('a rejected promise renders the authored Spanish retry state', async () => {
    const d = deferred<void>();
    render(<Harness promise={d.promise} />);

    d.reject(new UiError('vendor_timeout', 'req-77'));
    await screen.findByTestId('processing-error');

    expect(screen.getByTestId('processing-error').textContent).toContain(
      'El servicio de voz tardó demasiado',
    );
    // The English error code must never leak into the UI.
    expect(document.body.textContent).not.toContain('vendor_timeout');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  test('Reintentar calls back instead of hanging', () => {
    const onRetry = vi.fn();
    render(
      <ProcessingSheet transcript={TRANSCRIPT} error={new UiError('proxy_unreachable')} onRetry={onRetry} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

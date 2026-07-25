/**
 * T17 RED — S3 count screen: blind counting, the anomaly block, and the
 * AUTHORED «Terminar conteo» control (REQ-OCF-2, REQ-OCF-5, REQ-OCF-9,
 * REQ-OCF-11, REQ-VC-5).
 *
 * The design has no control leading to S9 at all, so `done` is unreachable in
 * the prototype. REQ-OCF-9 authors one; the last describe block proves it
 * really reaches `screen === 'done'` through the REAL reducer, not just that a
 * button dispatches an event.
 */
import { fireEvent, render } from '@testing-library/preact';
import { useReducer } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';

import { CountScreen } from '../../../src/components/operator/CountScreen';
import { initialSessionState, sessionReducer } from '../../../src/lib/session/reducer';
import type { CountRecord, SessionEvent, SessionState } from '../../../src/lib/session/types';

const AT = Date.UTC(2026, 6, 25, 13, 12, 0);

const BLOCKED_BANNER = 'Micrófono en pausa hasta resolver el registro señalado.';
const BLIND_FOOTER = 'Conteo ciego: nunca verás el stock del sistema.';

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

function countState(patch: Partial<SessionState> = {}): SessionState {
  return {
    ...initialSessionState,
    screen: 'count',
    micPermission: 'granted',
    catalogueId: 'stock_restaurante_fuentes_ayb',
    records: [record()],
    ...patch,
  };
}

function renderCount(patch: Partial<SessionState> = {}) {
  const dispatch = vi.fn<(event: SessionEvent) => void>();
  const onStartRecording = vi.fn();
  const onStopRecording = vi.fn();
  const view = render(
    <CountScreen
      state={countState(patch)}
      dispatch={dispatch}
      onStartRecording={onStartRecording}
      onStopRecording={onStopRecording}
    />,
  );
  return { ...view, dispatch, onStartRecording, onStopRecording };
}

function micOf(view: { getByRole: ReturnType<typeof render>['getByRole'] }): HTMLElement {
  return view.getByRole('button', { name: /Mantén presionado para dictar/ });
}

describe('CountScreen — plan header and progress', () => {
  it('renders the plan label and the progress figure', () => {
    const { container, getByRole } = renderCount({ progress: { counted: 45, total: 107 } });

    expect(container.textContent).toContain('Restaurante Fuentes · AyB');
    expect(container.textContent).toContain('45 / 107');
    expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45');
  });

  it('moves the progress bar with the count', () => {
    const { getByRole } = renderCount({ progress: { counted: 61, total: 107 } });

    expect(getByRole('progressbar').getAttribute('aria-valuenow')).toBe('61');
    expect(getByRole('progressbar').getAttribute('aria-valuemax')).toBe('107');
  });

  it('renders the record count line', () => {
    const { container } = renderCount({
      records: [record({ id: 'a' }), record({ id: 'b' }), record({ id: 'c' })],
    });

    expect(container.textContent).toContain('Registros de esta bodega');
    expect(container.textContent).toContain('3 registros');
  });
});

describe('CountScreen — blind counting invariant (REQ-OCF-2 / RF-18, QA-12)', () => {
  it('renders the blind-counting footer verbatim', () => {
    const { container } = renderCount();

    expect(container.textContent).toContain(BLIND_FOOTER);
  });

  it('renders no theoretical stock value anywhere in the tree', () => {
    const leaky = { ...record(), systemQty: 999, teorico: 777 } as unknown as CountRecord;
    const { container } = renderCount({ records: [leaky] });

    expect(container.textContent).not.toContain('999');
    expect(container.textContent).not.toContain('777');
    expect(container.textContent).not.toMatch(/te[oó]rico/i);
  });
});

describe('CountScreen — C2: no offline claim (REQ-OCF-11)', () => {
  it('never renders "Funciona sin señal"', () => {
    const { container } = renderCount({ records: [record({ state: 'sync' })] });

    expect(container.textContent).not.toContain('Funciona sin señal');
  });
});

describe('CountScreen — push-to-talk wiring (REQ-VC-5)', () => {
  it('dispatches REC_STARTED on pointerdown and hands the take to the session', () => {
    const view = renderCount();

    fireEvent.pointerDown(micOf(view));

    expect(view.dispatch).toHaveBeenCalledWith({ type: 'REC_STARTED' });
    expect(view.onStartRecording).toHaveBeenCalledTimes(1);
  });

  it('ends the take on pointerup', () => {
    const view = renderCount({ recording: true });

    fireEvent.pointerDown(micOf(view));
    fireEvent.pointerUp(micOf(view));

    expect(view.onStopRecording).toHaveBeenCalledTimes(1);
  });
});

describe('CountScreen — anomaly block (REQ-OCF-5)', () => {
  it('shows the pause banner while a record is flagged unresolved', () => {
    const { container } = renderCount({ records: [record({ state: 'anom_open' })] });

    expect(container.textContent).toContain(BLOCKED_BANNER);
  });

  it('makes the mic inert while blocked', () => {
    const view = renderCount({ records: [record({ state: 'anom_open' })] });

    fireEvent.pointerDown(micOf(view));

    expect(view.dispatch).not.toHaveBeenCalledWith({ type: 'REC_STARTED' });
    expect(view.onStartRecording).not.toHaveBeenCalled();
  });

  it('leaves the mic live once nothing is flagged', () => {
    const view = renderCount({ records: [record({ state: 'anom_noted' })] });

    fireEvent.pointerDown(micOf(view));

    expect(view.dispatch).toHaveBeenCalledWith({ type: 'REC_STARTED' });
  });
});

describe('CountScreen — «Terminar conteo» (REQ-OCF-9, authored)', () => {
  it('exists on the count screen', () => {
    const { getByRole } = renderCount();

    expect(getByRole('button', { name: 'Terminar conteo' })).toBeTruthy();
  });

  it('dispatches COUNT_FINISHED when activated', () => {
    const { getByRole, dispatch } = renderCount();

    fireEvent.click(getByRole('button', { name: 'Terminar conteo' }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'COUNT_FINISHED' });
  });

  it('is disabled while an overlay is open', () => {
    const { getByRole } = renderCount({
      overlay: { kind: 'processing', transcript: null },
    });

    expect((getByRole('button', { name: 'Terminar conteo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('is disabled while a request is in flight', () => {
    const { getByRole } = renderCount({ requestInFlight: true });

    expect((getByRole('button', { name: 'Terminar conteo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('is enabled on an idle count screen', () => {
    const { getByRole } = renderCount();

    expect((getByRole('button', { name: 'Terminar conteo' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('CountScreen — «Terminar conteo» actually reaches S9 through the real reducer', () => {
  function Host() {
    const [state, dispatch] = useReducer(sessionReducer, countState());
    return (
      <>
        <p data-testid="screen">{state.screen}</p>
        {state.screen === 'count' ? <CountScreen state={state} dispatch={dispatch} /> : null}
      </>
    );
  }

  it('transitions screen from count to done', () => {
    const { getByRole, getByTestId } = render(<Host />);
    expect(getByTestId('screen').textContent).toBe('count');

    fireEvent.click(getByRole('button', { name: 'Terminar conteo' }));

    expect(getByTestId('screen').textContent).toBe('done');
  });
});

/**
 * T17 RED — the mic dock: push-to-talk only, local elapsed timer, blocked state
 * (REQ-VC-5, REQ-VC-6, REQ-OCF-5, RF-12).
 */
import { act, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MicDock,
  formatElapsed,
  micBackground,
} from '../../../src/components/operator/MicDock';

const IDLE_HINT = 'Mantén presionado y dicta. Ej.: «3 kilos de lechuga, 12 botellas de aceite».';
const BLOCKED_HINT = 'Resuelve el registro señalado para seguir contando.';
const BLOCKED_BANNER = 'Micrófono en pausa hasta resolver el registro señalado.';

function renderDock(props: { recording?: boolean; blocked?: boolean } = {}) {
  const handlers = { onStart: vi.fn<() => void>(), onStop: vi.fn<() => void>() };
  const view = render(
    <MicDock
      recording={props.recording ?? false}
      blocked={props.blocked ?? false}
      onStart={handlers.onStart}
      onStop={handlers.onStop}
    />,
  );
  const mic = view.getByRole('button', { name: /Mantén presionado para dictar/ });
  return { ...view, ...handlers, mic };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MicDock — push-to-talk only (REQ-VC-5 / RF-12)', () => {
  it('starts on pointerdown', () => {
    const { mic, onStart, onStop } = renderDock();

    fireEvent.pointerDown(mic);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('stops on pointerup', () => {
    const { mic, onStop } = renderDock({ recording: true });

    fireEvent.pointerDown(mic);
    fireEvent.pointerUp(mic);

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stops on pointerleave exactly as on pointerup', () => {
    const { mic, onStop } = renderDock({ recording: true });

    fireEvent.pointerDown(mic);
    fireEvent.pointerLeave(mic);

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('has no toggle path: a repeated pointerdown never re-starts and never stops', () => {
    const { mic, onStart, onStop } = renderDock({ recording: true });

    fireEvent.pointerDown(mic);
    fireEvent.pointerDown(mic);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('records a second take only after the finger is released', () => {
    const { mic, onStart, onStop } = renderDock();

    fireEvent.pointerDown(mic);
    fireEvent.pointerUp(mic);
    fireEvent.pointerDown(mic);

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('MicDock — hints and blocked state (REQ-OCF-5)', () => {
  it('renders the idle hint verbatim', () => {
    const { container } = renderDock();

    expect(container.textContent).toContain(IDLE_HINT);
    expect(container.textContent).not.toContain(BLOCKED_BANNER);
  });

  it('renders the blocked hint and banner verbatim while blocked', () => {
    const { container } = renderDock({ blocked: true });

    expect(container.textContent).toContain(BLOCKED_HINT);
    expect(container.textContent).toContain(BLOCKED_BANNER);
    expect(container.textContent).not.toContain(IDLE_HINT);
  });

  it('makes the mic inert while blocked', () => {
    const { mic, onStart } = renderDock({ blocked: true });

    fireEvent.pointerDown(mic);

    expect(onStart).not.toHaveBeenCalled();
    expect((mic as HTMLButtonElement).disabled).toBe(true);
  });

  it('never claims offline capability (C2 / REQ-OCF-11)', () => {
    const { container } = renderDock({ blocked: true });

    expect(container.textContent).not.toContain('Funciona sin señal');
  });
});

describe('MicDock — local elapsed timer (REQ-VC-6)', () => {
  it('counts up from the local clock while recording, with no STT input at all', async () => {
    vi.useFakeTimers();
    const { mic, container } = renderDock({ recording: true });

    fireEvent.pointerDown(mic);
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });

    expect(container.textContent).toContain('Suelta para procesar · 0:04');
  });

  it('keeps counting past the first second boundary', async () => {
    vi.useFakeTimers();
    const { mic, container } = renderDock({ recording: true });

    fireEvent.pointerDown(mic);
    await act(async () => {
      vi.advanceTimersByTime(12_500);
    });

    expect(container.textContent).toContain('Suelta para procesar · 0:12');
  });

  it('shows no timer while idle', () => {
    const { container } = renderDock();

    expect(container.textContent).not.toContain('Suelta para procesar');
  });

  it('announces the recording state to assistive technology', () => {
    const { getByRole } = renderDock({ recording: true });

    expect(getByRole('status').textContent).toContain('Grabando');
  });
});

describe('formatElapsed — pure m:ss formatting', () => {
  it('formats the start of a take', () => {
    expect(formatElapsed(0)).toBe('0:00');
  });

  it('formats the design’s 0:04 example', () => {
    expect(formatElapsed(4_000)).toBe('0:04');
  });

  it('formats the 20 s cap', () => {
    expect(formatElapsed(20_000)).toBe('0:20');
  });

  it('rolls over into minutes', () => {
    expect(formatElapsed(65_400)).toBe('1:05');
  });

  it('never renders a negative elapsed value', () => {
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('micBackground — colours come from tokens, never from hardcoded hex', () => {
  it('maps blocked to the disabled token', () => {
    expect(micBackground('blocked')).toBe('var(--disabled-bg-2)');
  });

  it('maps recording to the accent token', () => {
    expect(micBackground('recording')).toBe('var(--accent)');
  });

  it('maps idle to the primary token', () => {
    expect(micBackground('idle')).toBe('var(--primary)');
  });

  it('never returns a literal hex value', () => {
    for (const state of ['blocked', 'recording', 'idle'] as const) {
      expect(micBackground(state)).not.toContain('#');
    }
  });
});

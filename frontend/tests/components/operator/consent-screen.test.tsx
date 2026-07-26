/**
 * T16 RED — S1 consent screen (REQ-OCF-10 / C1, REQ-OCF-11 / C2, REQ-VC-7).
 *
 * The headline case is the C1 compliance fix: the design's retention claim is
 * legally false under RNF-04, so the corrected copy must be present verbatim and
 * the old claim must be unreachable from any render path.
 */
import { fireEvent, render, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { ConsentScreen } from '../../../src/components/operator/ConsentScreen';
import { PlansScreen } from '../../../src/components/operator/PlansScreen';
import { initialSessionState } from '../../../src/lib/session/reducer';
import type { SessionEvent, SessionState } from '../../../src/lib/session/types';
import { getUserMediaMock } from '../../setup';

/** REQ-OCF-10: the exact replacement for the design's 12-month retention claim. */
const CORRECTED_RETENTION_COPY =
  'El audio no se guarda: se transmite para transcribirlo y se descarta al instante. ' +
  'Solo se conserva la transcripción de lo que dictas.';

const FALLBACK_NOTE =
  'Sin autorización el conteo se hace escribiendo artículo por artículo. ' +
  'Puedes autorizar más tarde desde tu perfil.';

const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

/** REQ-SDA-2: the consent write is blocking, so every render needs the seam. */
const PERSIST_ERROR = 'No pudimos registrar tu autorización. Revisa la conexión e inténtalo de nuevo.';

function permisoState(patch: Partial<SessionState> = {}): SessionState {
  return { ...initialSessionState, ...patch };
}

function renderConsent(
  patch: Partial<SessionState> = {},
  persistConsent: (input: { operatorId: string }) => Promise<unknown> = async () => ({ id: 'vc-1' }),
) {
  const dispatch = vi.fn<(event: SessionEvent) => void>();
  const persist = vi.fn(persistConsent);
  const view = render(
    <ConsentScreen
      state={permisoState(patch)}
      dispatch={dispatch}
      operatorId={OPERATOR_ID}
      persistConsent={persist}
    />,
  );
  return { ...view, dispatch, persist };
}

/** A PlansScreen that never touches the network — the copy checks below only
 *  care about what the screen renders, not where the plans came from. */
function renderPlans() {
  return render(
    <PlansScreen dispatch={vi.fn()} operatorId={OPERATOR_ID} loadPlans={async () => []} />,
  );
}

function notAllowed(): Error {
  const error = new Error('Permission denied');
  error.name = 'NotAllowedError';
  return error;
}

describe('ConsentScreen — C1 corrected retention copy (REQ-OCF-10)', () => {
  it('states verbatim that the audio is NOT stored', () => {
    const { container } = renderConsent();

    expect(container.textContent).toContain(CORRECTED_RETENTION_COPY);
  });

  it('keeps the design row title "Cuánto se conserva" that the copy belongs to', () => {
    const { getByText } = renderConsent();

    expect(getByText('Cuánto se conserva')).toBeTruthy();
  });

  it('never renders the false "12 meses" retention claim', () => {
    const { container } = renderConsent({ consentChecked: true });

    expect(container.textContent).not.toContain('12 meses');
    expect(container.textContent).not.toMatch(/el audio se guarda/i);
  });

  it('never renders the false "12 meses" claim on the plans screen either', () => {
    const { container } = renderPlans();

    expect(container.textContent).not.toContain('12 meses');
    expect(container.textContent).not.toMatch(/el audio se guarda/i);
  });
});

describe('ConsentScreen — C2 no offline claim (REQ-OCF-11)', () => {
  it('never renders "Funciona sin señal"', () => {
    const { container } = renderConsent();
    const plans = renderPlans();

    expect(container.textContent).not.toContain('Funciona sin señal');
    expect(plans.container.textContent).not.toContain('Funciona sin señal');
  });
});

describe('ConsentScreen — Ley 1581 disclosure (RF-22)', () => {
  it('renders the authorisation block with the controller identification', () => {
    const { container, getByText } = renderConsent();

    expect(getByText('Autorización de tratamiento de datos')).toBeTruthy();
    expect(container.textContent).toContain('860.007.336-1');
    expect(container.textContent).toContain('Ley 1581 de 2012');
    expect(container.textContent).toContain('Decreto 1074 de 2015');
    expect(container.textContent).toContain('protecciondedatos@colsubsidio.com');
    expect(getByText('Ver política completa de privacidad')).toBeTruthy();
  });
});

describe('ConsentScreen — consent gate (REQ-VC-7)', () => {
  it('disables «Permitir el micrófono» until the checkbox is ticked', () => {
    const { getByRole } = renderConsent({ consentChecked: false });

    expect((getByRole('button', { name: 'Permitir el micrófono' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables «Permitir el micrófono» once consent is checked', () => {
    const { getByRole } = renderConsent({ consentChecked: true });

    expect((getByRole('button', { name: 'Permitir el micrófono' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('dispatches CONSENT_TOGGLED when the checkbox is activated', () => {
    const { getByLabelText, dispatch } = renderConsent({ consentChecked: false });

    fireEvent.click(
      getByLabelText('He leído y autorizo el tratamiento de mi voz en los términos anteriores.'),
    );

    expect(dispatch).toHaveBeenCalledWith({ type: 'CONSENT_TOGGLED' });
  });

  it('does not call getUserMedia while consent is unchecked', () => {
    const { getByRole } = renderConsent({ consentChecked: false });

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    expect(getUserMediaMock).not.toHaveBeenCalled();
  });
});

describe('ConsentScreen — microphone permission is requested at consent (REQ-VC-7)', () => {
  it('calls getUserMedia right there and dispatches MIC_GRANTED', async () => {
    const { getByRole, dispatch } = renderConsent({ consentChecked: true });

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'MIC_GRANTED' }));
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it('routes a NotAllowedError denial to the manual fallback and never to plans', async () => {
    getUserMediaMock.mockRejectedValueOnce(notAllowed());
    const { getByRole, container, dispatch } = renderConsent({ consentChecked: true });

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'MIC_DENIED' }));
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'MIC_GRANTED' });
    expect(container.textContent).toContain(FALLBACK_NOTE);
  });
});

/* -------------------------------------------------------------------------- */
/* Task 2.7 — the consent write is BLOCKING (REQ-SDA-2, REQ-OCF-10, D5)        */
/* -------------------------------------------------------------------------- */

describe('ConsentScreen — acceptance persists before it advances (REQ-SDA-2)', () => {
  it('writes the consent for the identified operator and only then dispatches MIC_GRANTED', async () => {
    const { getByRole, dispatch, persist } = renderConsent({ consentChecked: true });

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'MIC_GRANTED' }));
    expect(persist).toHaveBeenCalledWith({ operatorId: OPERATOR_ID });
  });

  it('does NOT advance while the write is still in flight', async () => {
    let settle = (): void => {};
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { getByRole, dispatch } = renderConsent({ consentChecked: true }, async () => {
      await gate;
      return { id: 'vc-1' };
    });

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    // The microphone is already granted, yet the flow is still on S1: consent is
    // legally significant, so nothing advances until the row really exists.
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'MIC_GRANTED' });

    settle();
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'MIC_GRANTED' }));
  });

  it('shows a retryable error and stays on S1 when the write fails', async () => {
    const { getByRole, findByRole, dispatch } = renderConsent(
      { consentChecked: true },
      async () => {
        throw new Error('network down');
      },
    );

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    const alert = await findByRole('alert');
    expect(alert.textContent).toContain(PERSIST_ERROR);
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'MIC_GRANTED' });
    expect(getByRole('button', { name: 'Reintentar' })).toBeTruthy();
    // The consent CTA is still there: the operator never left the screen.
    expect(getByRole('button', { name: 'Permitir el micrófono' })).toBeTruthy();
  });

  it('«Reintentar» re-attempts the write and advances once it succeeds', async () => {
    let attempts = 0;
    const { getByRole, findByRole, dispatch, persist } = renderConsent(
      { consentChecked: true },
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('network down');
        return { id: 'vc-2' };
      },
    );

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));
    const retry = within(await findByRole('alert')).getByRole('button', { name: 'Reintentar' });

    fireEvent.click(retry);

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'MIC_GRANTED' }));
    expect(persist).toHaveBeenCalledTimes(2);
    // The retry writes consent again; it does NOT re-prompt for the microphone,
    // which the operator already granted.
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });

  it('never writes consent when the microphone is denied', async () => {
    getUserMediaMock.mockRejectedValueOnce(notAllowed());
    const { getByRole, dispatch, persist } = renderConsent({ consentChecked: true });

    fireEvent.click(getByRole('button', { name: 'Permitir el micrófono' }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'MIC_DENIED' }));
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('ConsentScreen — «No autorizar por ahora» (design S1)', () => {
  it('shows the fallback note without requesting the microphone', () => {
    const { getByRole, container } = renderConsent({ consentChecked: true });

    expect(container.textContent).not.toContain(FALLBACK_NOTE);
    fireEvent.click(getByRole('button', { name: 'No autorizar por ahora' }));

    expect(container.textContent).toContain(FALLBACK_NOTE);
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });
});

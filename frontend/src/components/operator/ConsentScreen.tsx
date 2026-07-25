/**
 * S1 «Autoriza el uso de tu voz» — the consent gate (REQ-OCF-10, REQ-VC-7).
 *
 * TWO authored departures from the design prototype, both deliberate:
 *
 *  1. C1 (blocking compliance fix). The prototype's "Cuánto se conserva" row
 *     claims the audio is kept 12 months for audit. That is false under RNF-04
 *     — the STT service proves it with tests that make disk spooling raise —
 *     and it contradicts the auditor design's own legend ("La voz no se
 *     almacena."). Under Ley 1581 a retention statement is a disclosure, not
 *     decoration, so the copy is replaced by REQ-OCF-10's exact wording.
 *  2. Real controls. The prototype paints a checkbox with a Material Symbols
 *     ligature and a div-as-button. Both are real form controls here so the
 *     screen is keyboard- and screen-reader-operable.
 *
 * `getUserMedia` is called from THIS screen (REQ-VC-7): a browser/OS denial has
 * to be caught while the operator is still on the consent step, where the
 * designed manual fallback lives — never mid-count at the first dictation.
 */
import { useState } from 'preact/hooks';

import { requestMicrophone, type MicrophoneResult } from '../../lib/audio/capture';
import type { SessionEvent, SessionState } from '../../lib/session/types';

export interface ConsentScreenProps {
  state: SessionState;
  dispatch: (event: SessionEvent) => void;
  /** Injectable for tests; production uses the real `requestMicrophone`. */
  requestMic?: () => Promise<MicrophoneResult>;
  /** Handed the live stream so the session can build recorders from it. */
  onGranted?: (stream: MediaStream) => void;
}

/* -------------------------------------------------------------------------- */
/* Copy (Colombian Spanish, verbatim from the design contract unless noted)    */
/* -------------------------------------------------------------------------- */

const CHECKBOX_LABEL =
  'He leído y autorizo el tratamiento de mi voz en los términos anteriores.';

const FALLBACK_NOTE =
  'Sin autorización el conteo se hace escribiendo artículo por artículo. ' +
  'Puedes autorizar más tarde desde tu perfil.';

interface InfoRow {
  icon: string;
  title: string;
  body: string;
}

/**
 * The four disclosure rows. Titles are verbatim from the design; the bodies of
 * rows 1, 2 and 4 are authored (the prototype ships only the titles for them),
 * and row 3 is REQ-OCF-10's mandated replacement text.
 */
const INFO_ROWS: readonly InfoRow[] = [
  {
    icon: 'graphic_eq',
    title: 'Qué se graba',
    body:
      'Solo lo que dictas mientras mantienes presionado el micrófono. ' +
      'Nada se graba en segundo plano.',
  },
  {
    icon: 'inventory_2',
    title: 'Para qué se usa',
    body: 'Únicamente para convertir tu dictado en registros del conteo físico.',
  },
  {
    icon: 'schedule',
    title: 'Cuánto se conserva',
    // REQ-OCF-10 (C1) — exact replacement for the design's 12-month claim.
    body:
      'El audio no se guarda: se transmite para transcribirlo y se descarta al instante. ' +
      'Solo se conserva la transcripción de lo que dictas.',
  },
  {
    icon: 'lock',
    title: 'Quién lo ve',
    body: 'El auditor del conteo ve la transcripción y el registro. Nadie más.',
  },
];

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function ConsentScreen({
  state,
  dispatch,
  requestMic = requestMicrophone,
  onGranted,
}: ConsentScreenProps) {
  const [pending, setPending] = useState(false);
  const [showFallback, setShowFallback] = useState(state.micPermission === 'denied');

  const allow = async (): Promise<void> => {
    // Belt and braces: the button is disabled, and the handler still refuses.
    // The permission prompt must never fire without a ticked checkbox.
    if (!state.consentChecked || pending) return;

    setPending(true);
    dispatch({ type: 'MIC_REQUESTED' });

    const result = await requestMic();
    setPending(false);

    if (result.ok) {
      onGranted?.(result.stream);
      dispatch({ type: 'MIC_GRANTED' });
      return;
    }
    // Denied or unavailable: stay on this screen and offer the manual path.
    setShowFallback(true);
    dispatch({ type: 'MIC_DENIED' });
  };

  const decline = (): void => {
    setShowFallback(true);
  };

  return (
    <section class="consent" aria-labelledby="consent-title">
      <header class="consent__header">
        <span class="msr consent__mark" aria-hidden="true">
          mic
        </span>
        <h1 id="consent-title" class="consent__title">
          Autoriza el uso de tu voz
        </h1>
        <p class="consent__sub">
          Para contar hablando necesitamos grabar y transcribir lo que dictas. Tú decides.
        </p>
      </header>

      <ul class="consent__rows">
        {INFO_ROWS.map((row) => (
          <li key={row.title} class="consent__row">
            <span class="msr consent__row-icon" aria-hidden="true">
              {row.icon}
            </span>
            <div>
              <h2 class="consent__row-title">{row.title}</h2>
              <p class="consent__row-body">{row.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <section class="consent__legal" aria-labelledby="consent-legal-title">
        <h2 id="consent-legal-title" class="consent__legal-title">
          Autorización de tratamiento de datos
        </h2>
        <p class="consent__legal-body">
          Caja Colombiana de Subsidio Familiar Colsubsidio, NIT 860.007.336-1, trata tus datos
          conforme a la Ley 1581 de 2012 y al Decreto 1074 de 2015. Puedes conocer, actualizar,
          rectificar o suprimir tus datos escribiendo a protecciondedatos@colsubsidio.com.
        </p>
        <a class="consent__legal-link" href="https://www.colsubsidio.com/politica-de-privacidad">
          Ver política completa de privacidad
        </a>
      </section>

      <div class="consent__check">
        <input
          id="consent-accept"
          type="checkbox"
          checked={state.consentChecked}
          onChange={() => dispatch({ type: 'CONSENT_TOGGLED' })}
        />
        <label for="consent-accept">{CHECKBOX_LABEL}</label>
      </div>

      {showFallback ? (
        <p class="consent__fallback" role="status">
          {FALLBACK_NOTE}
        </p>
      ) : null}

      <footer class="consent__actions">
        <button
          type="button"
          class="btn btn--primary"
          disabled={!state.consentChecked || pending}
          onClick={() => void allow()}
        >
          Permitir el micrófono
        </button>
        <button type="button" class="btn btn--ghost" onClick={decline}>
          No autorizar por ahora
        </button>
      </footer>
    </section>
  );
}

export default ConsentScreen;

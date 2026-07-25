/**
 * S4 — the processing overlay (REQ-OCF-12, RNF-11).
 *
 * PROMISE-DRIVEN, NOT TIMED. The prototype closed this overlay on a fixed
 * sub-two-second mock delay. The real STT worst case is
 * `STT_TOTAL_DEADLINE_S = 45`, so this component owns no timer at all: it
 * renders while `CountSession` holds a pending pipeline promise and disappears
 * when that promise settles. The only motion is the three CSS-animated `vdot`
 * dots.
 *
 * HONESTY (contract C4). The design's chip reads "Verificando con tres
 * modelos…", but the 3-model consensus (Module 2) does not exist. The default
 * copy therefore describes what actually happens; the design string is reachable
 * only through the explicit `mockConsensus` flag, for scripted demos. The
 * fabricated "Consenso 3/3" badge is not rendered anywhere.
 */
import type { UiError, UiErrorCode } from '../../lib/api/types';
import { Sheet } from './Sheet';

/**
 * Authored Spanish copy for every failure the client can distinguish.
 * `UiError.message` is the English code by design, so it never reaches the UI.
 * Exported so the count-screen error banner can reuse exactly these strings.
 */
export const PIPELINE_ERROR_COPY: Readonly<Record<UiErrorCode, string>> = {
  payload_too_large: 'La grabación quedó muy larga. Dicta menos artículos por vez.',
  invalid_audio: 'No se pudo leer el audio. Vuelve a dictar.',
  vendor_timeout: 'El servicio de voz tardó demasiado. Intenta otra vez.',
  vendor_error: 'El servicio de voz falló. Intenta otra vez.',
  validation: 'La grabación no se pudo procesar. Vuelve a dictar.',
  unknown_catalogue: 'Esta bodega no está disponible. Avisa al auditor.',
  proxy_unreachable: 'No hay conexión con el servidor. Intenta otra vez.',
  aborted: 'La grabación se canceló.',
  garbage: 'No se entendió lo que dictaste. Acércate al micrófono y vuelve a dictar.',
  nothing_extracted:
    'No reconocí ninguna cantidad. Di la cantidad y el artículo, por ejemplo «3 kilos de lechuga».',
};

const DOT_DELAYS = ['0s', '.18s', '.36s'] as const;

export interface ProcessingSheetProps {
  /** Null until STT returns; the quoted block is omitted while it is absent. */
  transcript: string | null;
  /** Set when the pipeline promise rejected. Switches the sheet to retry copy. */
  error?: UiError | null;
  onRetry?: () => void;
  onDismissError?: () => void;
  /** Demo-only: restores the design's (unbacked) three-model wording. */
  mockConsensus?: boolean;
}

export function ProcessingSheet({
  transcript,
  error = null,
  onRetry,
  onDismissError,
  mockConsensus = false,
}: ProcessingSheetProps) {
  const hasTranscript = transcript !== null && transcript.trim() !== '';
  const statusCopy = mockConsensus
    ? 'Verificando con tres modelos…'
    : 'Transcribiendo y buscando en el catálogo…';

  return (
    <Sheet labelledBy="processing-title" testId="processing-sheet">
      <p
        id="processing-title"
        class="eyebrow"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        Escuché
      </p>

      {hasTranscript ? (
        <p
          data-testid="processing-transcript"
          style={{ fontSize: '17px', fontWeight: 600, lineHeight: 1.4, marginBottom: 'var(--sp-5)' }}
        >
          “{transcript}”
        </p>
      ) : null}

      {error === null ? (
        <div
          data-testid="processing-chip"
          role="status"
          aria-live="polite"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            padding: 'var(--sp-3) var(--sp-4)',
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface-pale-blue)',
            color: 'var(--brand-blue-deep)',
          }}
        >
          <span style={{ display: 'inline-flex', gap: '5px' }} aria-hidden="true">
            {DOT_DELAYS.map((delay) => (
              <span
                key={delay}
                data-testid="processing-dot"
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--brand-blue)',
                  animation: `vdot 1s infinite`,
                  animationDelay: delay,
                }}
              />
            ))}
          </span>
          <span data-testid="processing-status" style={{ fontSize: '13px', fontWeight: 600 }}>
            {statusCopy}
          </span>
        </div>
      ) : (
        <div data-testid="processing-error">
          <p
            style={{
              padding: 'var(--sp-4)',
              borderRadius: 'var(--r-card)',
              border: '1.5px solid var(--warn-border-2)',
              background: 'var(--warn-bg-2)',
              color: 'var(--warn-text)',
              fontSize: '14px',
              lineHeight: 1.45,
            }}
          >
            {PIPELINE_ERROR_COPY[error.code]}
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-5)' }}>
            <button
              type="button"
              onClick={() => onRetry?.()}
              style={{
                flex: 1.5,
                height: 'var(--h-primary)',
                borderRadius: 'var(--r-btn)',
                background: 'var(--brand-blue)',
                color: 'var(--surface)',
                fontWeight: 700,
              }}
            >
              Reintentar
            </button>
            {onDismissError ? (
              <button
                type="button"
                onClick={onDismissError}
                style={{
                  flex: 1,
                  height: 'var(--h-primary)',
                  borderRadius: 'var(--r-btn)',
                  border: '1.5px solid var(--border-4)',
                  color: 'var(--text-muted)',
                  fontWeight: 700,
                }}
              >
                Cerrar
              </button>
            ) : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}

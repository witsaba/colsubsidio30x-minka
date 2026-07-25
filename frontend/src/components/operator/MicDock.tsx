/**
 * The mic dock over the gradient fade (design contract §2 S3; REQ-VC-5,
 * REQ-VC-6, REQ-OCF-5).
 *
 * Push-to-talk ONLY (RF-12): `pointerdown` starts, `pointerup` and
 * `pointerleave` stop. There is no toggle anywhere in this file — the wiring is
 * delegated to `attachPushToTalk`, which is the single place that decides what
 * "held" means, and while the mic is blocked no listener is attached at all.
 *
 * The elapsed time comes from a LOCAL interval started when recording begins.
 * It is never derived from the STT response: `audio_duration_ms` is nullable
 * and would render as "0:00" or as a failure the moment the vendor omits it.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import { attachPushToTalk } from '../../lib/audio/capture';

export interface MicDockProps {
  recording: boolean;
  blocked: boolean;
  onStart: () => void;
  onStop: () => void;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

export type MicVisualState = 'blocked' | 'recording' | 'idle';

/**
 * The mic's three background states, as TOKENS. The design specifies
 * `#c9c9c1` / `#ffd000` / `#0067b1`; those literals live once, in tokens.css.
 */
export function micBackground(state: MicVisualState): string {
  if (state === 'blocked') return 'var(--disabled-bg-2)';
  if (state === 'recording') return 'var(--accent)';
  return 'var(--primary)';
}

/** Foreground for the same three states (design: dark on yellow, else white). */
export function micForeground(state: MicVisualState): string {
  return state === 'recording' ? 'var(--text)' : 'var(--surface)';
}

/** `m:ss`, as in the design's "Suelta para procesar · 0:04". */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** How often the local elapsed display refreshes. */
const TICK_INTERVAL_MS = 100;

/** Waveform bar heights, verbatim from the design contract §1. */
const WAVEFORM_BARS = [10, 22, 30, 18, 26, 14, 28, 20, 12, 24, 16, 26, 11];

/* -------------------------------------------------------------------------- */
/* Copy (verbatim)                                                            */
/* -------------------------------------------------------------------------- */

const IDLE_HINT = 'Mantén presionado y dicta. Ej.: «3 kilos de lechuga, 12 botellas de aceite».';
const BLOCKED_HINT = 'Resuelve el registro señalado para seguir contando.';
const BLOCKED_BANNER = 'Micrófono en pausa hasta resolver el registro señalado.';

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function MicDock({ recording, blocked, onStart, onStop }: MicDockProps) {
  const micRef = useRef<HTMLButtonElement | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Latest handlers, so re-attaching listeners is not required on every render.
  const handlers = useRef({ onStart, onStop });
  handlers.current = { onStart, onStop };

  useEffect(() => {
    const element = micRef.current;
    // While blocked the control carries no listeners at all: there is no code
    // path that could start a take, not merely a guard that returns early.
    if (element === null || blocked) return;

    return attachPushToTalk(element, {
      onStart: () => handlers.current.onStart(),
      onStop: () => handlers.current.onStop(),
    });
  }, [blocked]);

  useEffect(() => {
    if (!recording) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [recording]);

  const visual: MicVisualState = blocked ? 'blocked' : recording ? 'recording' : 'idle';

  return (
    <div class="mic-dock">
      {blocked ? (
        <p class="mic-dock__banner" role="status">
          <span class="msr" aria-hidden="true">
            pause_circle
          </span>
          {BLOCKED_BANNER}
        </p>
      ) : null}

      {recording ? (
        <div class="mic-dock__live">
          <div class="mic-dock__wave" aria-hidden="true">
            {WAVEFORM_BARS.map((height, i) => (
              <span
                key={i}
                class="mic-dock__bar"
                style={{
                  height: `${height}px`,
                  animationDuration: `${0.62 + (i % 4) * 0.11}s`,
                  animationDelay: `${i * 0.06}s`,
                }}
              />
            ))}
          </div>
          <p class="mic-dock__timer" role="status">
            Grabando. Suelta para procesar · {formatElapsed(elapsedMs)}
          </p>
        </div>
      ) : (
        <p class="mic-dock__hint">{blocked ? BLOCKED_HINT : IDLE_HINT}</p>
      )}

      <button
        ref={micRef}
        type="button"
        class="mic-dock__button"
        disabled={blocked}
        aria-label="Mantén presionado para dictar"
        style={{
          background: micBackground(visual),
          color: micForeground(visual),
          // Push-to-talk needs the browser to keep sending pointer events
          // instead of hijacking the hold as a scroll or a text selection.
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {recording ? <span class="mic-dock__pulse" aria-hidden="true" /> : null}
        <span class="msr" aria-hidden="true">
          mic
        </span>
      </button>
    </div>
  );
}

export default MicDock;

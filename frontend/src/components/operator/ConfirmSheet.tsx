/**
 * S5 — "Confirmar antes de guardar" (REQ-OCF-3, REQ-OCF-7, RF-14, RF-33, QA-22).
 *
 * This is where the multi-item split becomes visible: one dictation that yielded
 * N items renders N cards inside ONE sheet and a single yes/no decision.
 *
 * BLIND COUNTING IS STRUCTURAL HERE. The sheet renders quantity, unit, article
 * and SKU and nothing else — there is deliberately no prop through which a
 * theoretical or system stock value could ever be passed in, so it cannot leak.
 *
 * The design's `verified` "Consenso 3/3" badge is NOT ported: no 3-model
 * consensus exists (contract C4), and a fabricated badge on live data would be a
 * lie to the operator.
 *
 * EMPTY TRANSCRIPT. `Overlay.confirm` requires `transcript: string`, but the
 * `anomaly` and `search` overlays carry none, so when the resolution queue
 * advances out of one of those into the combined confirm sheet the reducer
 * passes `''`. That is genuine absence, not blankness: the quoted block is
 * omitted entirely rather than rendering empty quotes.
 */
import type { ConfirmableItem } from '../../lib/pipeline';
import { displayUnit } from '../../lib/units';
import { Sheet } from './Sheet';

export interface ConfirmSheetProps {
  /** Verbatim STT transcript, or `''` when the sheet was reached from a queue
   *  resolution that carried none. */
  transcript: string;
  items: ConfirmableItem[];
  onConfirm: () => void;
  onRepeat: () => void;
  /** S8 exclusion flow (stretch). The ghost link renders only when wired. */
  onExclude?: () => void;
}

export function ConfirmSheet({ transcript, items, onConfirm, onRepeat, onExclude }: ConfirmSheetProps) {
  const hasTranscript = transcript.trim() !== '';

  return (
    <Sheet labelledBy="confirm-title" testId="confirm-sheet">
      <p id="confirm-title" class="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
        Confirmar antes de guardar
      </p>

      {hasTranscript ? (
        <p
          data-testid="confirm-transcript"
          style={{ fontSize: '13px', color: 'var(--text-soft-2)', marginBottom: 'var(--sp-4)' }}
        >
          “{transcript}”
        </p>
      ) : null}

      <ul style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
        {items.map((entry, index) => {
          const unit = displayUnit(entry.picked.unidad_display);
          const sku = entry.picked.nr_articulo;
          return (
            <li
              key={`${entry.picked.articulo}-${index}`}
              data-testid="confirm-item"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 'var(--sp-3)',
                padding: 'var(--sp-4)',
                borderRadius: 'var(--r-card)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                boxShadow: 'var(--shadow-row)',
              }}
            >
              <span class="qty" style={{ fontSize: '26px' }}>
                {entry.extracted.quantity}
              </span>
              {/* A null unidad_display renders NO unit element at all — never a
                  default, never the English canonical unit. */}
              {unit !== null ? (
                <span
                  data-testid="confirm-unit"
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: 'var(--text-soft-2)',
                  }}
                >
                  {unit}
                </span>
              ) : null}
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>
                  {entry.picked.articulo}
                </span>
                {/* ~18% of the real catalogue has no code: the SKU line stays,
                    the code is simply absent. */}
                <span class="mono-meta" data-testid="confirm-sku" style={{ display: 'block' }}>
                  {sku === null ? 'Sin código' : sku}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div data-testid="confirm-actions" style={{ display: 'flex', gap: 'var(--sp-3)' }}>
        <button
          type="button"
          onClick={onRepeat}
          style={{
            flex: 1,
            height: 'var(--h-primary)',
            borderRadius: 'var(--r-btn)',
            border: '1.5px solid var(--border-4)',
            color: 'var(--text-muted)',
            fontWeight: 700,
          }}
        >
          Repetir
        </button>
        <button
          type="button"
          onClick={onConfirm}
          style={{
            flex: 1.5,
            height: 'var(--h-primary)',
            borderRadius: 'var(--r-btn)',
            background: 'var(--brand-blue)',
            color: 'var(--surface)',
            fontWeight: 700,
          }}
        >
          Confirmar
        </button>
      </div>

      {onExclude ? (
        <button
          type="button"
          onClick={onExclude}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 'var(--sp-4)',
            fontSize: '13px',
            color: 'var(--text-soft-2)',
            textDecoration: 'underline',
          }}
        >
          Vi un producto vencido o roto
        </button>
      ) : null}
    </Sheet>
  );
}

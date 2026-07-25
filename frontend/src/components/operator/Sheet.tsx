/**
 * The bottom-sheet shell shared by S4-S7 (design contract §2).
 *
 * The prototypes ship the scrim and the `vrise` animation but ZERO
 * accessibility: no `role`, no `aria-*`, no focus management, no keyboard exit.
 * Everything below the visual port is therefore authored:
 *
 *   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
 *   - focus moves into the sheet on mount and is trapped there while it is open
 *   - Escape dismisses ONLY when `onEscape` is supplied. Processing, confirm and
 *     anomaly are deliberately non-dismissible: the operator must resolve them,
 *     and the anomaly sheet is what keeps the mic blocked (REQ-OCF-5).
 *
 * The scrim colour, radius and `vrise .22s ease both` come from `global.css`
 * (`.scrim` and `[role='dialog'].sheet`); no colour is hardcoded here.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface SheetProps {
  /** Id of the element that names the sheet. */
  labelledBy: string;
  describedBy?: string;
  testId: string;
  /** Supplied only where dismissal is legal. Omit to make Escape inert. */
  onEscape?: () => void;
  children: ComponentChildren;
}

export function Sheet({ labelledBy, describedBy, testId, onEscape, children }: SheetProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the sheet as soon as it opens.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? node).focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const node = dialogRef.current;
      if (!node) return;

      if (event.key === 'Escape') {
        if (onEscape) {
          event.preventDefault();
          onEscape();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }

      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && node.contains(active);

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onEscape]);

  return (
    <div
      class="scrim"
      style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        ref={dialogRef}
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-testid={testId}
        style={{
          width: '100%',
          maxWidth: 'var(--operator-max-width)',
          padding: 'var(--sp-6) var(--sp-5) var(--sp-5)',
          maxHeight: '82vh',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}

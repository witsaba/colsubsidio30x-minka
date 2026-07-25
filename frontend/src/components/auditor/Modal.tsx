/**
 * Auditor modal — centered, 480px, radius 24px (design contract §3 "Modals").
 *
 * The prototypes ship ZERO aria: the modal is a plain div, focus stays behind
 * it, Escape does nothing and the scrim is not dismissible. Everything below —
 * `role="dialog"`, `aria-modal`, the accessible name, the initial focus move,
 * the focus trap and the Escape handler — is an authored accessibility
 * addition, not a port.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';

/** Icon tint; maps to the token ramp, never to a literal hex. */
export type ModalTone = 'warn' | 'info';

export interface ModalProps {
  /** Material Symbols ligature, e.g. `error` / `ios_share`. */
  icon: string;
  tone: ModalTone;
  title: string;
  body: string;
  /** Optional form fields rendered between the copy and the actions. */
  children?: ComponentChildren;
  /** Label of the dismissing control. Always the SECONDARY action. */
  cancelLabel: string;
  /** Label of the committing control. Always the PRIMARY action. */
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  icon,
  tone,
  title,
  body,
  children,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus must land inside the dialog, otherwise a keyboard user keeps tabbing
  // through the dashboard behind the scrim.
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    // Wrap explicitly rather than relying on the browser: the dialog is not a
    // native <dialog>, so nothing else keeps focus inside it.
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last?.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div class="scrim" onKeyDown={onKeyDown}>
      <div
        class="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <span class={`modal__icon modal__icon--${tone}`} aria-hidden="true">
          {icon}
        </span>
        <h2 class="modal__title" id={titleId}>
          {title}
        </h2>
        <p class="modal__body">{body}</p>

        {children}

        <div class="modal__actions">
          <button type="button" class="btn btn--secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            class="btn btn--primary"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

interface ModalProps {
  /** Id of the heading that names the dialog, for screen readers. */
  titleId: string;
  /** A click outside, Escape, or the dialog's own cancel. */
  onClose(): void;
  children: ComponentChildren;
}

/**
 * The overlay the dialogs share: a click outside closes, Escape closes, and
 * Tab stays inside. The caller focuses its first control when it opens.
 */
export function Modal({ titleId, onClose, children }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);

  return (
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') {
          return;
        }

        const focusables = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [],
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === undefined || last === undefined) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div class="dialog" ref={dialog}>
        {children}
      </div>
    </div>
  );
}

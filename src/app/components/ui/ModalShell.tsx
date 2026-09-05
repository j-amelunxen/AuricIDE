'use client';

import type { ReactNode } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import type { OverlayKind } from '@/lib/overlays/stack';

export interface ModalShellProps {
  /** Unique identifier registered in the overlay stack. */
  id: string;
  /** Layer kind in overlay stack, defaults to 'tool'. */
  kind?: OverlayKind;
  /** Whether the overlay layer is active, defaults to true. */
  active?: boolean;
  /** Optional modal title rendered as an h2 in the dialog header. */
  title?: string;
  /** Optional custom id for the title element (defaults to `${id}-modal-title`). */
  titleId?: string;
  /** Accessible label if title element is not rendered. */
  ariaLabel?: string;
  /** Additional CSS class names for the inner dialog container. */
  className?: string;
  /** Additional CSS class names for the outer backdrop container. */
  backdropClassName?: string;
  /** Callback fired when the modal should close (backdrop click or Escape). */
  onClose: () => void;
  /** Whether clicking the backdrop triggers onClose, defaults to true. */
  closeOnBackdropClick?: boolean;
  /** Child elements rendered inside the dialog container. */
  children: ReactNode;
}

/**
 * Reusable modal shell providing accessible dialog semantics, focus trapping/restoration,
 * overlay stack registration, backdrop rendering, and keyboard (Escape) management.
 */
export function ModalShell({
  id,
  kind = 'tool',
  active = true,
  title,
  titleId,
  ariaLabel,
  className = '',
  backdropClassName = '',
  onClose,
  closeOnBackdropClick = true,
  children,
}: ModalShellProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id, kind, active, onEscape: onClose });

  const computedTitleId = title ? (titleId ?? `${id}-modal-title`) : undefined;

  return (
    <div
      className={`fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/60 backdrop-blur-sm ${backdropClassName}`.trim()}
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={computedTitleId}
        aria-label={!computedTitleId ? ariaLabel : undefined}
        className={`bg-background-secondary border border-border-dark rounded-lg shadow-2xl p-5 flex flex-col gap-4 ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id={computedTitleId} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

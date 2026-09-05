'use client';

import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface SearchPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  overlayId: string;
  topOffsetClass?: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  headerExtra?: ReactNode;
  children?: ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
}

export function SearchPaletteModal({
  isOpen,
  onClose,
  ariaLabel,
  overlayId,
  topOffsetClass = 'pt-[15vh]',
  placeholder,
  query,
  onQueryChange,
  onKeyDown,
  headerExtra,
  children,
  footerLeft,
  footerRight,
}: SearchPaletteModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: overlayId, kind: 'tool', active: isOpen, onEscape: onClose });

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[var(--z-tool)] flex items-start justify-center ${topOffsetClass} bg-black/40 backdrop-blur-sm`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="glass-card w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-white/5">
          <AuricIcon name="search" className="text-foreground-muted" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-foreground-muted"
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {headerExtra}
        </div>

        <div className="max-h-[400px] overflow-y-auto py-2">{children}</div>

        <div className="flex items-center justify-between px-4 py-2 bg-black/20 border-t border-white/5 text-[9px] text-foreground-muted uppercase tracking-tighter">
          {footerLeft ?? (
            <div className="flex gap-4">
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-white/5 px-1 font-mono">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-white/5 px-1 font-mono">↵</kbd> Open
              </span>
            </div>
          )}
          {footerRight && <span>{footerRight}</span>}
        </div>
      </div>
    </div>
  );
}

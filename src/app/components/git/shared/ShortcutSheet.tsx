'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { spokenKeys } from './shortcutKeys';

export interface ShortcutItem {
  /** Glyphs as printed on the key caps, e.g. `['⌥', '↓']`. */
  keys: string[];
  action: string;
}

export interface ShortcutGroup {
  label: string;
  items: ShortcutItem[];
}

export interface ShortcutSheetContent {
  title: string;
  groups: ShortcutGroup[];
}

/**
 * Key caps for one shortcut. The glyphs are hidden from assistive tech and
 * replaced by words ("Option Down arrow"), because "⌥↓" is read as two
 * symbol names at best and as nothing at worst.
 */
export function ShortcutKeys({ keys, className = '' }: { keys: string[]; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="min-w-[1.25rem] rounded border border-border-dark bg-white/[0.04] px-1 py-px text-center font-sans text-[11px] leading-4 text-foreground"
          >
            {key}
          </kbd>
        ))}
      </span>
      <span className="sr-only">{spokenKeys(keys)}</span>
    </span>
  );
}

/** The `?` sheet: every shortcut of one surface, grouped, in a modal dialog. */
export function ShortcutSheet({
  title,
  groups,
  onClose,
}: ShortcutSheetContent & { onClose: () => void }) {
  const dialogRef = useDialogA11y();
  const titleId = useId();
  const layerId = useId();
  useOverlayLayer({ id: `shortcuts:${layerId}`, kind: 'confirm', active: true, onEscape: onClose });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="shortcut-sheet"
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-border-dark bg-surface p-4 shadow-2xl shadow-black/50 outline-none"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-sm font-medium text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded text-foreground-muted hover:bg-hover-bg hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <AuricIcon name="close" className="text-sm" />
          </button>
        </div>
        {groups.map((group) => (
          <section key={group.label} className="mb-3 last:mb-0" aria-label={group.label}>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
              {group.label}
            </h3>
            <dl className="divide-y divide-white/5">
              {group.items.map((item) => (
                <div key={item.action} className="flex items-center justify-between gap-4 py-1.5">
                  <dt className="text-xs text-foreground">{item.action}</dt>
                  <dd>
                    <ShortcutKeys keys={item.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * State for one surface's sheet. The surface decides when `?` means "open"
 * (see `isShortcutSheetKey`) and renders `sheet` somewhere in its tree.
 */
export function useShortcutSheet(content: ShortcutSheetContent): {
  open: () => void;
  close: () => void;
  isOpen: boolean;
  sheet: ReactNode;
} {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const sheet = isOpen ? <ShortcutSheet {...content} onClose={close} /> : null;
  return { open, close, isOpen, sheet };
}

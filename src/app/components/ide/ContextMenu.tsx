'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export type ContextMenuOption =
  | { type: 'separator' }
  | { type: 'header'; label: string }
  | {
      type?: 'item';
      label: string;
      icon?: string;
      iconColor?: string;
      /** A custom mark in place of the icon glyph — e.g. a project tile.
       *  Wrapped decorative (aria-hidden), same as the icon it replaces. */
      leading?: React.ReactNode;
      action?: () => void;
      danger?: boolean;
      /** Skip the auto-close after this item's action — for an item that
       *  leads to a further stage (e.g. a project that opens an epic
       *  sub-menu) rather than finishing the interaction. Defaults to false:
       *  every existing call site keeps closing on click. */
      keepOpen?: boolean;
    };

/** How much of the viewport a menu may claim before it scrolls internally. */
const MAX_MENU_VIEWPORT_FRACTION = 0.7;

interface ContextMenuProps {
  x: number;
  y: number;
  options: ContextMenuOption[];
  onClose: () => void;
  /** Drawn above the items. An input in here takes focus instead of the first item. */
  preface?: React.ReactNode;
  /** Defaults to the menu's usual 176px. */
  width?: number;
}

function useDismissMenu(
  menuRef: React.RefObject<HTMLDivElement | null>,
  onCloseRef: React.RefObject<() => void>
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    // Next tick: the click that opened this menu must not also dismiss it.
    const listen = window.setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside, true);
    }, 0);
    return () => {
      window.clearTimeout(listen);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [menuRef, onCloseRef]);
}

function focusMenuStart(root: HTMLElement) {
  // An input in the preface is the gesture (type a badge, hit Enter).
  // Focusing a menu item instead would steal the keystrokes.
  const field = root.querySelector<HTMLElement>('input, textarea');
  (field ?? root.querySelector<HTMLElement>('[role="menuitem"]'))?.focus();
}

function estimateMenuHeight(options: ContextMenuOption[], hasPreface: boolean): number {
  return options.reduce(
    (acc, opt) => {
      if (opt.type === 'separator') return acc + 9;
      if (opt.type === 'header') return acc + 24;
      return acc + 44;
    },
    hasPreface ? 120 : 10
  );
}

function renderMenuEntry(option: ContextMenuOption, index: number, onClose: () => void) {
  if (option.type === 'separator') {
    return <div key={index} role="separator" className="my-1 border-t border-white/5" />;
  }

  if (option.type === 'header') {
    return (
      <div
        key={index}
        role="presentation"
        className="px-3 py-1 text-[9px] font-bold text-foreground-muted/50 uppercase tracking-wider"
      >
        {option.label}
      </div>
    );
  }

  return (
    <button
      key={index}
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        if (typeof window !== 'undefined') {
          try {
            window.focus();
          } catch {
            // ignore
          }
        }
        option.action?.();
        if (!option.keepOpen) onClose();
      }}
      className={`flex w-full items-center gap-2 px-3 min-h-11 text-left text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
        option.danger
          ? 'text-red-400 hover:bg-red-500/10 focus-visible:bg-red-500/20'
          : 'text-foreground-muted hover:bg-primary/10 hover:text-foreground focus-visible:bg-primary/20'
      }`}
    >
      {option.leading ? (
        /* Decorative — the label speaks for the item. */
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {option.leading}
        </span>
      ) : (
        option.icon && (
          /* Decorative — the label speaks for the item. */
          <AuricIcon
            name={option.icon}
            aria-hidden="true"
            className="text-[14px]"
            style={option.iconColor ? { color: option.iconColor } : undefined}
          />
        )
      )}
      {/* title, not a replacement label: the text content still wins
          as the accessible name, so a truncated skill stays findable. */}
      <span className="min-w-0 flex-1 truncate font-medium" title={option.label}>
        {option.label}
      </span>
    </button>
  );
}

export function ContextMenu({ x, y, options, onClose, preface, width = 176 }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useDismissMenu(menuRef, onCloseRef);

  useEffect(() => {
    if (menuRef.current) focusMenuStart(menuRef.current);
  }, []);

  // Adjust position if menu goes off screen
  const menuWidth = width;
  const estimatedHeight = estimateMenuHeight(options, preface !== undefined && preface !== null);
  // A menu taller than the panel scrolls, so clamp the estimate to what it can
  // actually occupy — otherwise the keep-it-off-the-bottom-edge correction
  // pushes a long menu clean off the top instead.
  const menuHeight = Math.min(estimatedHeight, window.innerHeight * MAX_MENU_VIEWPORT_FRACTION);

  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));

  // Portal past any ancestor `transform` (tile enter animation keeps
  // scale(1) via fill-mode). `fixed` inside that box would interpret
  // clientX/clientY as offsets of the tile, not the viewport.
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      className="fixed z-[var(--z-tool)] overflow-hidden rounded-lg border border-white/10 bg-surface/95 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in duration-100"
      style={{ left: adjustedX, top: adjustedY, width: menuWidth }}
    >
      {preface && <div className="border-b border-white/5">{preface}</div>}
      <div className="max-h-[70vh] overflow-y-auto py-1">
        {options.map((option, index) => renderMenuEntry(option, index, onClose))}
      </div>
    </div>,
    document.body
  );
}

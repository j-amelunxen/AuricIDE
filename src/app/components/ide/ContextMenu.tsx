'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
      /** The item cannot run now. It stays in the menu with this sentence under
       *  its label, so the reason is readable without hovering. */
      disabledReason?: string;
      /** Makes the item one choice of a group: a `menuitemradio` that says whether it is the chosen one. */
      checked?: boolean;
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
  /** Names the menu for assistive technology. */
  ariaLabel?: string;
  /** Dense, macOS-sized rows (28px) for menus that sit in a dense tool. */
  compact?: boolean;
}

const ITEM_SELECTOR = '[role^="menuitem"]';

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

function estimateMenuHeight(
  options: ContextMenuOption[],
  hasPreface: boolean,
  compact: boolean
): number {
  return options.reduce(
    (acc, opt) => {
      if (opt.type === 'separator') return acc + 9;
      if (opt.type === 'header') return acc + 24;
      return acc + (compact ? 28 : 44);
    },
    hasPreface ? 120 : 10
  );
}

type MenuItemOption = Exclude<ContextMenuOption, { type: 'separator' } | { type: 'header' }>;

function renderMenuHeader(label: string, index: number, compact: boolean) {
  return (
    <div
      key={index}
      role="presentation"
      className={`px-3 py-1 ${
        // A compact header names a ref; uppercasing would misstate a case-sensitive name.
        compact
          ? 'text-[11px] font-semibold text-foreground-muted'
          : 'text-[9px] font-bold uppercase tracking-wider text-foreground-muted/50'
      }`}
    >
      {label}
    </div>
  );
}

function menuItemTone(option: MenuItemOption): string {
  if (option.disabledReason) return 'cursor-not-allowed text-foreground-muted';
  if (option.danger) return 'text-red-400 hover:bg-red-500/10 focus-visible:bg-red-500/20';
  return 'text-foreground-muted hover:bg-primary/10 hover:text-foreground focus-visible:bg-primary/20';
}

function runMenuItem(option: MenuItemOption, onClose: () => void) {
  if (option.disabledReason) return;
  if (typeof window !== 'undefined') {
    try {
      window.focus();
    } catch {
      // ignore
    }
  }
  option.action?.();
  if (!option.keepOpen) onClose();
}

function renderMenuLeading(option: MenuItemOption) {
  if (option.leading) {
    /* Decorative — the label speaks for the item. */
    return (
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {option.leading}
      </span>
    );
  }
  if (!option.icon) return null;
  /* Decorative — the label speaks for the item. */
  return (
    <AuricIcon
      name={option.icon}
      aria-hidden="true"
      className="text-[14px]"
      style={option.iconColor ? { color: option.iconColor } : undefined}
    />
  );
}

function renderMenuEntry(
  option: ContextMenuOption,
  index: number,
  onClose: () => void,
  menuId: string,
  compact: boolean
) {
  if (option.type === 'separator') {
    return <div key={index} role="separator" className="my-1 border-t border-white/5" />;
  }
  if (option.type === 'header') return renderMenuHeader(option.label, index, compact);

  const reasonId = option.disabledReason ? `${menuId}-reason-${index}` : undefined;
  return (
    <button
      key={index}
      role={option.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={option.checked}
      aria-disabled={reasonId ? true : undefined}
      aria-labelledby={reasonId ? `${menuId}-label-${index}` : undefined}
      aria-describedby={reasonId}
      onClick={(e) => {
        e.stopPropagation();
        runMenuItem(option, onClose);
      }}
      className={`flex w-full items-center gap-2 px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
        compact ? 'min-h-7 py-1 text-xs' : 'min-h-11 text-[11px]'
      } ${menuItemTone(option)}`}
    >
      {renderMenuLeading(option)}
      {/* title, not a replacement label: the text content still wins
          as the accessible name, so a truncated skill stays findable. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          id={`${menuId}-label-${index}`}
          className={`truncate font-medium ${reasonId ? 'opacity-60' : ''}`}
          title={option.label}
        >
          {option.label}
        </span>
        {reasonId && (
          <span id={reasonId} className="text-[11px] font-normal">
            {option.disabledReason}
          </span>
        )}
      </span>
    </button>
  );
}

/** Remembers what had focus when the menu opened and hands it back on close, unless focus has moved on. */
function useRestoreFocus() {
  const [opener] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  useEffect(
    () => () => {
      const active = document.activeElement;
      const focusIsLost = !active || active === document.body;
      if (focusIsLost && opener?.isConnected) opener.focus();
    },
    [opener]
  );
}

function moveFocus(menu: HTMLElement, key: string): boolean {
  const items = Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  if (items.length === 0) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const target: Record<string, number> = {
    ArrowDown: (at + 1) % items.length,
    ArrowUp: (at <= 0 ? items.length : at) - 1,
    Home: 0,
    End: items.length - 1,
  };
  if (!(key in target)) return false;
  items[target[key]].focus();
  return true;
}

export function ContextMenu({
  x,
  y,
  options,
  onClose,
  preface,
  width = 176,
  ariaLabel = 'Context menu',
  compact = false,
}: ContextMenuProps) {
  useRestoreFocus();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
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
  const estimatedHeight = estimateMenuHeight(
    options,
    preface !== undefined && preface !== null,
    compact
  );
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
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (menuRef.current && moveFocus(menuRef.current, e.key)) e.preventDefault();
      }}
      className="fixed z-[var(--z-tool)] overflow-hidden rounded-lg border border-white/10 bg-surface/95 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in duration-100"
      style={{ left: adjustedX, top: adjustedY, width: menuWidth }}
    >
      {preface && <div className="border-b border-white/5">{preface}</div>}
      <div className="max-h-[70vh] overflow-y-auto py-1">
        {options.map((option, index) => renderMenuEntry(option, index, onClose, menuId, compact))}
      </div>
    </div>,
    document.body
  );
}

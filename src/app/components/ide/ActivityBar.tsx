'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface ActivityItem {
  id: string;
  icon: string;
  label: string;
  badge?: number;
  /**
   * 'tools' demotes an item below the separator with compact styling —
   * means, not destinations. Omitted = primary loop surface.
   */
  section?: 'primary' | 'tools';
}

export interface ActivityBarProps {
  items: ActivityItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onTerminalToggle?: () => void;
  onAgentsToggle?: () => void;
}

const iconMap: Record<string, string> = {
  folder: 'folder_open',
  commit: 'source',
  extension: 'extension',
  settings: 'settings',
  toc: 'toc',
  hub: 'hub',
};

/** Screen-space point a hover label is pinned to: the icon's right edge. */
interface TooltipAnchor {
  top: number;
  left: number;
}

/** Air between the icon's right edge and the label. */
const TOOLTIP_GAP_PX = 12;

/**
 * Places a rail hover label in viewport coordinates.
 *
 * The label reaches roughly 120px past a 56px rail, and the rail scrolls —
 * so parked inside the scroller it becomes scrollable overflow, and since
 * `overflow-y: auto` computes `overflow-x` to `auto`, that is a horizontal
 * scrollbar under the icons. Measuring the button and drawing the label
 * outside the scroller keeps the rail exactly as wide as its icons.
 */
function useRailTooltip() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ top: rect.top + rect.height / 2, left: rect.right + TOOLTIP_GAP_PX });
  }, []);
  const hide = useCallback(() => setAnchor(null), []);

  const isOpen = anchor !== null;
  useEffect(() => {
    if (!isOpen) return;
    // A pinned label knows nothing about the rail scrolling under it, nor about
    // the window resizing beneath it — so re-measure rather than leave it behind.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [isOpen, place]);

  return {
    anchorRef,
    anchor,
    tooltipHandlers: { onMouseEnter: place, onMouseLeave: hide, onFocus: place, onBlur: hide },
  };
}

/**
 * Fast, on-brand hover label. Replaces the native `title` tooltip (≈1s OS
 * delay, unstyled) so an icon-only rail stays discoverable and consistent
 * with the rest of the polish (wayfinding). Purely visual —
 * assistive tech reads the button's `aria-label`, so this is aria-hidden.
 *
 * Drawn into `document.body`: `position: fixed` alone would still be caught by
 * the `active:scale-95` press, which makes the button a containing block for
 * fixed descendants and hands the label back to the scroller mid-click.
 */
function ActivityTooltip({
  id,
  label,
  anchor,
}: {
  id: string;
  label: string;
  anchor: TooltipAnchor;
}) {
  return createPortal(
    <span
      role="tooltip"
      aria-hidden="true"
      data-testid={`activity-tooltip-${id}`}
      style={{ top: anchor.top, left: anchor.left, zIndex: 'var(--z-tool)' }}
      className="activity-tooltip-enter pointer-events-none fixed whitespace-nowrap rounded-md border border-white/10 bg-[rgba(10,10,16,0.92)] px-2 py-1 text-xs font-medium text-foreground shadow-lg backdrop-blur-md"
    >
      {label}
    </span>,
    document.body
  );
}

function ActivityButton({
  item,
  isActive,
  onSelect,
}: {
  item: ActivityItem;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const isTool = item.section === 'tools';
  const { anchorRef, anchor, tooltipHandlers } = useRailTooltip();
  return (
    <>
      <button
        ref={anchorRef}
        data-testid={`activity-item-${item.id}`}
        onClick={() => onSelect(item.id)}
        aria-label={item.label}
        {...tooltipHandlers}
        className={`group relative flex items-center justify-center rounded-xl transition-colors duration-150 active:scale-95 ${
          isTool ? 'h-8 w-8' : 'h-10 w-10'
        } ${
          isActive
            ? 'bg-primary/10 text-primary neon-glow'
            : `text-foreground-muted hover:bg-white/5 hover:text-foreground ${isTool ? 'opacity-70 hover:opacity-100' : ''}`
        }`}
      >
        <AuricIcon
          name={iconMap[item.icon] || item.icon}
          aria-hidden="true"
          className={`transition-transform duration-150 ${
            isTool ? 'text-base' : 'text-xl'
          } ${isActive ? 'scale-110' : 'group-hover:scale-105'}`}
        />

        {/* Active Indicator Pips */}
        {isActive && (
          <span className="absolute -left-1 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        )}

        {item.badge !== null && item.badge !== undefined && item.badge > 0 && (
          <span
            data-testid={`badge-${item.id}`}
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white shadow-sm ring-2 ring-[#050508]"
          >
            {item.badge}
          </span>
        )}
      </button>

      {anchor && <ActivityTooltip id={item.id} label={item.label} anchor={anchor} />}
    </>
  );
}

/** A bottom-of-rail panel toggle — same affordances as an item, no destination. */
function PanelToggleButton({
  id,
  label,
  icon,
  onClick,
}: {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  const { anchorRef, anchor, tooltipHandlers } = useRailTooltip();
  return (
    <>
      <button
        ref={anchorRef}
        onClick={onClick}
        aria-label={label}
        {...tooltipHandlers}
        className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-foreground-muted transition-colors duration-150 active:scale-95 hover:bg-white/5 hover:text-foreground"
      >
        <AuricIcon
          name={icon}
          aria-hidden="true"
          className="text-xl transition-transform duration-150 group-hover:scale-110"
        />
      </button>

      {anchor && <ActivityTooltip id={id} label={label} anchor={anchor} />}
    </>
  );
}

export function ActivityBar({
  items,
  activeId,
  onSelect,
  onTerminalToggle,
  onAgentsToggle,
}: ActivityBarProps) {
  const settings = items.find((item) => item.id === 'settings');
  const rest = items.filter((item) => item.id !== 'settings');
  const primary = rest.filter((item) => item.section !== 'tools');
  const tools = rest.filter((item) => item.section === 'tools');

  return (
    <nav
      data-testid="activity-bar"
      className="glass-panel flex h-full min-h-0 w-14 flex-col items-center py-4 z-20"
    >
      <div
        data-testid="activity-rail-scroll"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-4 overflow-y-auto"
      >
        {primary.map((item) => (
          <ActivityButton
            key={item.id}
            item={item}
            isActive={item.id === activeId}
            onSelect={onSelect}
          />
        ))}

        {tools.length > 0 && (
          <>
            <div
              data-testid="activity-section-separator"
              aria-hidden="true"
              className="h-[1px] w-6 bg-white/10"
            />
            {tools.map((item) => (
              <ActivityButton
                key={item.id}
                item={item}
                isActive={item.id === activeId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </div>

      {settings && (
        <div
          data-testid="activity-settings-pin"
          className="mt-2 flex flex-shrink-0 flex-col items-center"
        >
          <ActivityButton item={settings} isActive={settings.id === activeId} onSelect={onSelect} />
        </div>
      )}

      {/* Panel toggles at the bottom */}
      <div className="mt-2 flex flex-shrink-0 flex-col items-center gap-2">
        {onAgentsToggle && (
          <PanelToggleButton
            id="agents-toggle"
            label="Toggle Agents Panel"
            icon="smart_toy"
            onClick={onAgentsToggle}
          />
        )}
        {onTerminalToggle && (
          <PanelToggleButton
            id="terminal"
            label="Toggle Terminal (⌘J)"
            icon="terminal"
            onClick={onTerminalToggle}
          />
        )}
      </div>
    </nav>
  );
}

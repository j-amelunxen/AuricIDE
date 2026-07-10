'use client';

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
}

const iconMap: Record<string, string> = {
  folder: 'folder_open',
  commit: 'source',
  extension: 'extension',
  settings: 'tune',
  toc: 'toc',
  hub: 'hub',
};

/**
 * Fast, on-brand hover label. Replaces the native `title` tooltip (≈1s OS
 * delay, unstyled) so an icon-only rail stays discoverable and consistent
 * with the rest of the polish (Apple HIG §16 wayfinding). Purely visual —
 * assistive tech reads the button's `aria-label`, so this is aria-hidden.
 */
function ActivityTooltip({ id, label }: { id: string; label: string }) {
  return (
    <span
      role="tooltip"
      aria-hidden="true"
      data-testid={`activity-tooltip-${id}`}
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md border border-white/10 bg-[rgba(10,10,16,0.92)] px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-lg backdrop-blur-md transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
    >
      {label}
    </span>
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
  return (
    <button
      data-testid={`activity-item-${item.id}`}
      onClick={() => onSelect(item.id)}
      aria-label={item.label}
      className={`group relative flex items-center justify-center rounded-xl transition-colors duration-150 active:scale-95 ${
        isTool ? 'h-8 w-8' : 'h-10 w-10'
      } ${
        isActive
          ? 'bg-primary/10 text-primary neon-glow'
          : `text-foreground-muted hover:bg-white/5 hover:text-foreground ${isTool ? 'opacity-70 hover:opacity-100' : ''}`
      }`}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined transition-transform duration-150 ${
          isTool ? 'text-base' : 'text-xl'
        } ${isActive ? 'scale-110' : 'group-hover:scale-105'}`}
      >
        {iconMap[item.icon] || item.icon}
      </span>

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

      <ActivityTooltip id={item.id} label={item.label} />
    </button>
  );
}

export function ActivityBar({ items, activeId, onSelect, onTerminalToggle }: ActivityBarProps) {
  const primary = items.filter((item) => item.section !== 'tools');
  const tools = items.filter((item) => item.section === 'tools');

  return (
    <nav
      data-testid="activity-bar"
      className="glass-panel flex w-14 flex-col items-center justify-between py-4 z-20"
    >
      <div className="flex flex-col items-center gap-4 w-full">
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

      {/* Terminal Toggle at the bottom */}
      <button
        onClick={onTerminalToggle}
        aria-label="Toggle Terminal (⌘J)"
        className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-foreground-muted transition-colors duration-150 active:scale-95 hover:bg-white/5 hover:text-foreground"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-xl transition-transform duration-150 group-hover:scale-110"
        >
          terminal
        </span>
        <ActivityTooltip id="terminal" label="Toggle Terminal (⌘J)" />
      </button>
    </nav>
  );
}

'use client';

export interface ActivityItem {
  id: string;
  icon: string;
  label: string;
  badge?: number;
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

export function ActivityBar({ items, activeId, onSelect, onTerminalToggle }: ActivityBarProps) {
  return (
    <nav
      data-testid="activity-bar"
      className="glass-panel flex w-14 flex-col items-center justify-between py-4 z-20"
    >
      <div className="flex flex-col items-center gap-4 w-full">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              data-testid={`activity-item-${item.id}`}
              onClick={() => onSelect(item.id)}
              title={item.label}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 ${
                isActive
                  ? 'bg-primary/10 text-primary neon-glow'
                  : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <span
                className={`material-symbols-outlined text-xl transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`}
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
            </button>
          );
        })}
      </div>

      {/* Terminal Toggle at the bottom */}
      <button
        onClick={onTerminalToggle}
        title="Toggle Terminal (⌘J)"
        className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-foreground-muted transition-all duration-300 hover:bg-white/5 hover:text-foreground"
      >
        <span className="material-symbols-outlined text-xl group-hover:scale-110">terminal</span>
      </button>
    </nav>
  );
}

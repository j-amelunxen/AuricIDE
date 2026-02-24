'use client';

export type BottomTab = 'terminal' | 'problems';

export interface BottomPanelTabsProps {
  activeTab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  problemCount: number;
  terminalContent: React.ReactNode;
  problemsContent: React.ReactNode;
}

export function BottomPanelTabs({
  activeTab,
  onTabChange,
  problemCount,
  terminalContent,
  problemsContent,
}: BottomPanelTabsProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-white/5 bg-panel-bg">
        <button
          role="tab"
          aria-selected={activeTab === 'terminal'}
          onClick={() => onTabChange('terminal')}
          className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors ${
            activeTab === 'terminal'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          Terminal
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'problems'}
          onClick={() => onTabChange('problems')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors ${
            activeTab === 'problems'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          Problems
          {problemCount > 0 && (
            <span
              data-testid="problems-badge"
              className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 leading-none"
            >
              {problemCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'terminal' ? terminalContent : problemsContent}
      </div>
    </div>
  );
}

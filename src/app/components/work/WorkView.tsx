'use client';

import { useStore } from '@/lib/store';
import { WORK_TABS, type WorkTab } from '@/lib/work/tabs';
import { GoalsPanel } from '@/app/components/goals/GoalsModal';
import { TicketsPanel } from '@/app/components/pm/ProjectManagerModal';
import { RequirementsPanel } from '@/app/components/requirements/RequirementsModal';
import { GoalLinesPanel } from '@/app/components/goalLines/GoalLinesModal';
import { InfoTooltip } from '@/app/components/ui/InfoTooltip';

const LINES_HINT = 'The same goals, seen over time.';

export function WorkView() {
  const workTab = useStore((s) => s.workTab);
  const setWorkTab = useStore((s) => s.setWorkTab);

  return (
    <div data-testid="work-view" className="flex h-full flex-col bg-background-dark">
      <div
        role="tablist"
        aria-label="Work"
        className="flex shrink-0 items-center gap-1 border-b border-white/10 px-4 py-2"
      >
        {WORK_TABS.map((tab) => {
          const selected = workTab === tab.id;
          const isLines = tab.id === 'lines';
          return (
            <span key={tab.id} className="inline-flex items-center">
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`work-tab-${tab.id}`}
                title={isLines ? LINES_HINT : undefined}
                onClick={() => setWorkTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-white/10 text-foreground'
                    : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
              {isLines && <InfoTooltip description={LINES_HINT} />}
            </span>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{renderWorkPanel(workTab)}</div>
    </div>
  );
}

function renderWorkPanel(tab: WorkTab) {
  switch (tab) {
    case 'goals':
      return <GoalsPanel embedded />;
    case 'tickets':
      return <TicketsPanel embedded />;
    case 'requirements':
      return <RequirementsPanel embedded />;
    case 'lines':
      return <GoalLinesPanel embedded />;
  }
}

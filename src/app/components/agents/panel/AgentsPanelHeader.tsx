'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface AgentsPanelHeaderProps {
  runningCount: number;
  attentionCount: number;
  parkableCount: number;
  onParkAllWorking?: () => void;
  onOpenConsole?: () => void;
  onCollapse?: () => void;
}

export function AgentsPanelHeader({
  runningCount,
  attentionCount,
  parkableCount,
  onParkAllWorking,
  onOpenConsole,
  onCollapse,
}: AgentsPanelHeaderProps) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {attentionCount > 0 &&
          `${attentionCount} agent${attentionCount === 1 ? '' : 's'} need${
            attentionCount === 1 ? 's' : ''
          } attention`}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1 px-3 py-2 border-b border-border-dark">
        <h2 className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold tracking-wider text-foreground-muted">
          AGENTS
          {runningCount > 0 && (
            <span
              data-testid="agents-running-count"
              className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary-light tabular-nums"
            >
              {runningCount} running
            </span>
          )}
          {attentionCount > 0 && (
            <span
              data-testid="agents-attention-count"
              className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-400 tabular-nums"
            >
              {attentionCount} {attentionCount === 1 ? 'needs' : 'need'} attention
            </span>
          )}
          {runningCount > 0 && attentionCount === 0 && (
            <span
              data-testid="agents-all-quiet"
              className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-400/70"
            >
              <AuricIcon name="check" aria-hidden="true" className="text-[12px]" />
              all quiet
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          {parkableCount > 1 && onParkAllWorking && (
            <button
              type="button"
              onClick={onParkAllWorking}
              title="Set aside working (still running)"
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              Set aside {parkableCount}
            </button>
          )}
          {onOpenConsole && (
            <button
              type="button"
              data-testid="agents-open-console"
              onClick={onOpenConsole}
              aria-label="Open Agent Console"
              title="Open Agent Console"
              className="group flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <AuricIcon name="dashboard" aria-hidden="true" className="text-base" />
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Hide agents panel"
              className="group flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <AuricIcon name="right_panel_close" aria-hidden="true" className="text-base" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

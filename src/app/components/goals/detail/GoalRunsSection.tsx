'use client';

import type { PmGoalRun } from '@/lib/tauri/goals';

export const RUN_OUTCOME_STYLES: Record<string, string> = {
  running: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  killed: 'bg-gray-500/20 text-gray-300',
};

export interface GoalRunsSectionProps {
  goalRuns: PmGoalRun[];
  labelCls: string;
}

export function GoalRunsSection({ goalRuns, labelCls }: GoalRunsSectionProps) {
  return (
    <div>
      <label className={labelCls}>Agent runs ({goalRuns.length})</label>
      {goalRuns.length === 0 ? (
        <p className="text-[10px] text-foreground-muted/70">
          No agents launched for this goal yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {goalRuns.map((run) => (
            <li key={run.id} className="rounded-lg bg-white/5 px-2.5 py-2">
              <div className="flex items-center gap-2 text-[10px]">
                <span
                  className={`rounded-full px-1.5 py-0.5 font-bold ${RUN_OUTCOME_STYLES[run.outcome] ?? RUN_OUTCOME_STYLES.running}`}
                >
                  {run.outcome}
                </span>
                <span className="text-foreground-muted">
                  {run.model || 'model?'} · {run.source}
                </span>
                <span className="ml-auto tabular-nums text-foreground-muted/70">
                  {run.startedAt}
                </span>
              </div>
              {run.summary && <p className="mt-1 text-[10px] text-foreground/80">{run.summary}</p>}
              <details className="mt-1">
                <summary className="cursor-pointer text-[9px] text-foreground-muted hover:text-foreground">
                  Show prompt
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[9px] leading-relaxed text-foreground/70">
                  {run.prompt}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

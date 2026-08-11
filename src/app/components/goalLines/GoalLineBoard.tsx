'use client';

import type { PmGoal } from '@/lib/tauri/goals';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { GoalLine } from '@/lib/goals/goalLinesLayout';
import { GoalLineCard } from './GoalLineCard';

export interface GoalLineBoardProps {
  lines: GoalLine[];
  /** Root goals with nothing attached — listed quietly, never drawn as lines. */
  notStarted: PmGoal[];
  agentsById: Map<string, AgentInfo>;
  now: number;
  onOpenGoal: (goalId: string) => void;
  onQuickAdd: (goalId: string, name: string) => void;
  onTick: (stationId: string) => void;
  onMove: (goalId: string, stationId: string, toIndex: number) => void;
  onVerify: (stationId: string) => void;
  onReset: (goalId: string) => void;
}

/** The board: one card per goal that has work, plus a quiet not-started strip. */
export function GoalLineBoard({
  lines,
  notStarted,
  agentsById,
  now,
  onOpenGoal,
  onQuickAdd,
  onTick,
  onMove,
  onVerify,
  onReset,
}: GoalLineBoardProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="goal-line-board">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {lines.map((line) => (
          <GoalLineCard
            key={line.goalId}
            line={line}
            agentsById={agentsById}
            now={now}
            onOpen={onOpenGoal}
            onQuickAdd={onQuickAdd}
            onTick={onTick}
            onMove={onMove}
            onVerify={onVerify}
            onReset={onReset}
          />
        ))}
      </div>
      {notStarted.length > 0 && (
        <div
          data-testid="goal-lines-not-started"
          className="flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted"
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-foreground-muted/60">
            no work attached
          </span>
          {notStarted.map((goal) => (
            <button
              key={goal.id}
              onClick={() => onOpenGoal(goal.id)}
              className="rounded-lg border border-white/5 px-2.5 py-1 transition-colors hover:border-white/15 hover:text-foreground"
            >
              {goal.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

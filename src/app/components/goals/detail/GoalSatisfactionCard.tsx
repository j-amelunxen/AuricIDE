'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { PmGoal } from '@/lib/tauri/goals';

export interface GoalSatisfactionCardProps {
  goal: PmGoal;
  satisfaction: {
    satisfied: boolean;
    blockers: string[];
  };
  onAchieve: (id: string) => void;
}

export function GoalSatisfactionCard({ goal, satisfaction, onAchieve }: GoalSatisfactionCardProps) {
  return (
    <div
      data-testid="goal-satisfaction"
      className={`rounded-xl border p-3 ${
        satisfaction.satisfied
          ? 'border-green-500/30 bg-green-500/10'
          : 'border-white/10 bg-white/5'
      }`}
    >
      {satisfaction.satisfied ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-green-300">
            All checks pass. Ready to mark achieved.
          </p>
          {goal.status !== 'achieved' && (
            <button
              data-testid="goal-achieve-btn"
              onClick={() => onAchieve(goal.id)}
              className="rounded-lg bg-green-500/20 border border-green-500/30 px-3 py-1 text-[10px] font-bold text-green-300 hover:bg-green-500/30 transition-colors"
            >
              Mark achieved
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-muted">
            Open conditions ({satisfaction.blockers.length})
          </p>
          <ul className="space-y-1">
            {satisfaction.blockers.slice(0, 6).map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                <AuricIcon
                  name="radio_button_unchecked"
                  className="mt-px text-[12px] text-foreground-muted"
                />
                {b}
              </li>
            ))}
            {satisfaction.blockers.length > 6 && (
              <li className="text-[10px] text-foreground-muted">
                +{satisfaction.blockers.length - 6} more
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

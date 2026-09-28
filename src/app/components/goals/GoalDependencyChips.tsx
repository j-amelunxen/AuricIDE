'use client';

import type { PmGoal, PmGoalDependency } from '@/lib/tauri/goals';
import { normalizeBundle } from '@/lib/goals/goalDependencies';
import { getGoalBlockers } from '@/lib/store/goalsSlice';
import { summarizeBlockers } from '@/lib/orchestration/blockerLabel';

interface GoalDependencyChipsProps {
  goal: PmGoal;
  goals: PmGoal[];
  dependencies: PmGoalDependency[];
}

/**
 * A goal's "Bundle: X" and "⏸ waits for X" chips, computed from its bundle
 * label and dependency edges. Renders nothing on a goal with neither.
 */
export function GoalDependencyChips({ goal, goals, dependencies }: GoalDependencyChipsProps) {
  const bundleLabel = normalizeBundle(goal.bundle);
  const blockers = dependencies.length > 0 ? getGoalBlockers(goals, dependencies, goal.id) : [];
  const waitsForLabel = summarizeBlockers(goals, blockers);

  return (
    <>
      {bundleLabel && (
        <span
          data-testid={`goal-bundle-chip-${goal.id}`}
          title={`Bundle: ${bundleLabel}`}
          className="shrink-0 truncate rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary-light"
        >
          Bundle: {bundleLabel}
        </span>
      )}
      {waitsForLabel && (
        <span
          data-testid={`goal-blocked-chip-${goal.id}`}
          title={`Waits for ${waitsForLabel}`}
          className="shrink-0 truncate rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-300"
        >
          ⏸ waits for {waitsForLabel}
        </span>
      )}
    </>
  );
}

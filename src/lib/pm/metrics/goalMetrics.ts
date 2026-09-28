// ---------------------------------------------------------------------------
// Goal timing from pm_goal_status_history
// ---------------------------------------------------------------------------

import {
  type LifecycleModel,
  type LifecycleTiming,
  type StatusChange,
  type TimedChange,
  computeLifecycle,
  toTimed,
} from './lifecycle';

export interface GoalHistoryEntry extends StatusChange {
  goalId: string;
  /** `ui` | `mcp` | `backfill`. A backfill row is a snapshot, not an event. */
  source: string;
}

export interface GoalMetrics extends LifecycleTiming {
  /** How often the goal entered review. Above one means it came back for rework. */
  reviewRounds: number;
  /** The oldest event on record — nothing before it is known. */
  trackedSince: string | null;
  /**
   * The record starts at a snapshot taken when tracking was introduced, so the
   * goal's earlier statuses and its real creation time are unknown.
   */
  backfilled: boolean;
}

/** Statuses a goal is worked in. Review belongs to the spell: rework is not a restart. */
export const GOAL_WORKING_STATUSES: ReadonlySet<string> = new Set(['in_progress', 'in_review']);

type TimedGoalEntry = GoalHistoryEntry & TimedChange;

const GOAL_LIFECYCLE: LifecycleModel<TimedGoalEntry> = {
  completed: new Set(['achieved']),
  // Walk back from the completion over the unbroken working spell. A spell that
  // reaches back into the backfill snapshot has no known start.
  cycleStart: (untilCompletion) => {
    let start: TimedGoalEntry | undefined;
    for (let i = untilCompletion.length - 2; i >= 0; i--) {
      const entry = untilCompletion[i];
      if (!GOAL_WORKING_STATUSES.has(entry.toStatus)) break;
      start = entry;
    }
    return start?.source === 'backfill' ? undefined : start;
  },
};

/** Timing for one goal. `history` may hold other goals' rows; only `goalId`'s count. */
export function computeGoalMetrics(
  history: GoalHistoryEntry[],
  currentStatus: string,
  now: number = Date.now(),
  goalId?: string
): GoalMetrics {
  const entries = toTimed(goalId ? history.filter((e) => e.goalId === goalId) : history);
  const timing = computeLifecycle(entries, currentStatus, GOAL_LIFECYCLE, now);
  const first = entries.at(0);
  const backfilled = first?.source === 'backfill';

  return {
    ...timing,
    // A snapshot's stamp is not when the goal was created.
    leadTime: backfilled ? null : timing.leadTime,
    reviewRounds: entries.filter((e) => e.toStatus === 'in_review').length,
    trackedSince: first?.changedAt ?? null,
    backfilled,
  };
}

'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { persistQuietly } from '@/lib/store/persistFeedback';
import type { GoalConflict, GoalConflictChoice } from '@/lib/goals/goalConflicts';

export interface GoalConflictNoticeProps {
  goalId: string;
}

interface ClashLine {
  conflict: GoalConflict;
  label: string;
  fields: { field: string; mine: string; theirs: string }[];
}

const shown = (value: unknown): string =>
  value === null || value === undefined || value === ''
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

/**
 * The decision a clash between the person and an agent needs. The database
 * already holds the agent's value and the draft the person's (see
 * `goalConflicts.ts`); nothing moves until one of these buttons is pressed,
 * and the choice is saved right away so it does not wait for another edit.
 */
export function GoalConflictNotice({ goalId }: GoalConflictNoticeProps) {
  const conflicts = useStore((s) => s.goalConflicts);
  const goals = useStore((s) => s.goals);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const runs = useStore((s) => s.goalRuns);
  const runsDraft = useStore((s) => s.goalRunsDraft);
  const stations = useStore((s) => s.goalStations);
  const stationsDraft = useStore((s) => s.goalStationsDraft);
  const resolve = useStore((s) => s.resolveGoalConflict);
  const saveGoals = useStore((s) => s.saveGoals);
  const rootPath = useStore((s) => s.rootPath);

  const lines = useMemo<ClashLine[]>(() => {
    const pick = <T extends { id: string }>(rows: T[], id: string) =>
      rows.find((r) => r.id === id) as Record<string, unknown> | undefined;
    return conflicts.flatMap((conflict) => {
      const [persisted, draft] =
        conflict.table === 'pm_goals'
          ? [pick(goals, conflict.id), pick(goalsDraft, conflict.id)]
          : conflict.table === 'pm_goal_runs'
            ? [pick(runs, conflict.id), pick(runsDraft, conflict.id)]
            : [pick(stations, conflict.id), pick(stationsDraft, conflict.id)];
      const owner =
        conflict.table === 'pm_goals' ? conflict.id : (draft?.goalId ?? persisted?.goalId);
      if (owner !== goalId || !draft || !persisted) return [];
      const label =
        conflict.table === 'pm_goal_runs'
          ? `Run ${String(draft.agentId ?? conflict.id)}`
          : String(draft.name ?? conflict.id);
      const fields = conflict.columns.map((field) => ({
        field,
        mine: shown(draft[field]),
        theirs: shown(persisted[field]),
      }));
      return [{ conflict, label, fields }];
    });
  }, [conflicts, goals, goalsDraft, runs, runsDraft, stations, stationsDraft, goalId]);

  if (lines.length === 0) return null;

  const choose = (conflict: GoalConflict, choice: GoalConflictChoice) => {
    resolve(conflict.table, conflict.id, choice);
    if (rootPath) void persistQuietly(saveGoals(rootPath));
  };

  return (
    <div
      role="alert"
      data-testid="goal-conflict-notice"
      className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-foreground"
    >
      <p className="font-semibold">An agent changed this while you were editing it.</p>
      <p className="text-foreground-muted">
        Your change is not saved yet. Keep it, or take the agent&apos;s value.
      </p>
      <ul className="space-y-2">
        {lines.map(({ conflict, label, fields }) => (
          <li key={`${conflict.table}/${conflict.id}`} className="space-y-1">
            <p className="font-medium">{label}</p>
            {fields.map(({ field, mine, theirs }) => (
              <p key={field} className="text-foreground-muted">
                {field} — yours: {mine} · agent: {theirs}
              </p>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                aria-label={`Keep mine for ${label}`}
                onClick={() => choose(conflict, 'mine')}
                className="rounded-lg bg-white/10 px-2 py-1 hover:bg-white/15"
              >
                Keep mine
              </button>
              <button
                type="button"
                aria-label={`Take agent's value for ${label}`}
                onClick={() => choose(conflict, 'theirs')}
                className="rounded-lg bg-white/10 px-2 py-1 hover:bg-white/15"
              >
                Take agent&apos;s
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

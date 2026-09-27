/**
 * Bookkeeping for goal rows the person and an agent changed at the same time.
 *
 * The Rust sync writes an edited row only while the database still holds the
 * base the edit was made from (`goals_sync_impl`), and a reload spots the same
 * clash before any save (`findClashes`). Either way the row lands here: the
 * database keeps the agent's value, the draft keeps the person's, and the base
 * the edit was made from is pinned, so no later reload or save can quietly
 * count the agent's value as seen. Only `resolveGoalConflict` lets go of it.
 */
import type { PmGoal, PmGoalRun, PmGoalStation } from '../tauri/goals';

export type GoalConflictTable = 'pm_goals' | 'pm_goal_runs' | 'pm_goal_stations';

export interface GoalConflict {
  table: GoalConflictTable;
  id: string;
  /** Clashing fields, camelCase as in the draft rows, sorted. */
  columns: string[];
  /** The row the person's edit was made from. */
  base: PmGoal | PmGoalRun | PmGoalStation;
}

export type GoalConflictChoice = 'mine' | 'theirs';

interface Identified {
  id: string;
}

const camel = (column: string): string =>
  column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** `persisted`, with every conflicted row of `table` replaced by its pinned base. */
export function withPinnedBases<T extends Identified>(
  persisted: T[],
  conflicts: GoalConflict[],
  table: GoalConflictTable
): T[] {
  const pins = new Map(
    conflicts.filter((c) => c.table === table).map((c) => [c.id, c.base as unknown as T])
  );
  if (pins.size === 0) return persisted;
  return persisted.map((row) => pins.get(row.id) ?? row);
}

/** Conflicts for clashes found in `table`, each pinned to its row in `bases`. */
export function pinClashes<T extends Identified>(
  table: GoalConflictTable,
  clashes: { id: string; columns: string[] }[],
  bases: T[]
): GoalConflict[] {
  const baseById = new Map(bases.map((r) => [r.id, r]));
  return clashes.flatMap(({ id, columns }) => {
    const base = baseById.get(id);
    if (!base) return [];
    return [
      {
        table,
        id,
        columns: columns.map(camel).sort(),
        base: base as unknown as GoalConflict['base'],
      },
    ];
  });
}

/**
 * Folds newly found conflicts into the known ones. A row already pinned keeps
 * its original base (that is the value the person actually saw) and gains any
 * new columns; conflicts on rows that are gone from the database are dropped,
 * since the deletion wins and the draft row goes with it.
 */
export function mergeConflicts(
  known: GoalConflict[],
  found: GoalConflict[],
  stillThere: (table: GoalConflictTable, id: string) => boolean
): GoalConflict[] {
  const key = (c: GoalConflict) => `${c.table}/${c.id}`;
  const byKey = new Map(known.map((c) => [key(c), c]));
  for (const conflict of found) {
    const was = byKey.get(key(conflict));
    byKey.set(
      key(conflict),
      was
        ? { ...was, columns: [...new Set([...was.columns, ...conflict.columns])].sort() }
        : conflict
    );
  }
  return [...byKey.values()].filter((c) => stillThere(c.table, c.id));
}

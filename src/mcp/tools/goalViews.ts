import type Database from 'better-sqlite3';
import { isVerifiedEvidence } from '../../lib/pm/enums';
import { descendantIds, type GoalRow, type GoalRunRow } from './goalsDb';

/**
 * Agent-facing shapes of the goal tables. A tool answer stays in the agent's
 * context for the rest of its run, so the default is what an agent needs to
 * decide its next call, and the long text sits behind an explicit flag or
 * `get_goal`.
 */

export type GoalSummary = Pick<
  GoalRow,
  'id' | 'parent_id' | 'name' | 'status' | 'priority' | 'work_mode' | 'bundle' | 'updated_at'
>;

export function goalSummary(goal: GoalRow): GoalSummary {
  return {
    id: goal.id,
    parent_id: goal.parent_id,
    name: goal.name,
    status: goal.status,
    priority: goal.priority,
    work_mode: goal.work_mode,
    bundle: goal.bundle,
    updated_at: goal.updated_at,
  };
}

export type CompactGoalRun = Omit<GoalRunRow, 'prompt'> & { prompt_chars: number };

/** A run without its launch prompt: the prompt is the same few kB on every run. */
export function compactGoalRun({ prompt, ...run }: GoalRunRow): CompactGoalRun {
  return { ...run, prompt_chars: prompt.length };
}

export const FIND_GOALS_DEFAULT_LIMIT = 20;

/** Goals whose name contains `query` (ASCII case-insensitive), as summary rows. */
export function findGoals(
  db: Database.Database,
  query: string,
  options: { status?: string; limit?: number } = {}
): GoalSummary[] {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
  let sql = "SELECT * FROM pm_goals WHERE name LIKE '%' || ? || '%' ESCAPE '\\'";
  const params: (string | number)[] = [escaped];
  if (options.status) {
    sql += ' AND status = ?';
    params.push(options.status);
  }
  sql += ' ORDER BY sort_order, created_at LIMIT ?';
  params.push(options.limit ?? FIND_GOALS_DEFAULT_LIMIT);
  return (db.prepare(sql).all(...params) as GoalRow[]).map(goalSummary);
}

export type BlockingStationState = 'planned' | 'fog' | 'awaiting_judge' | 'rejected_by_judge';

export interface BlockingStation {
  stationId: string;
  goalId: string;
  name: string;
  /** Any status other than done is reported as it is stored. */
  state: BlockingStationState | string;
  /** The judge's reason for a rejection; null otherwise. */
  reason: string | null;
}

const REJECTED_PREFIX = 'rejected: ';

/**
 * The stations that keep a goal (or its subtree) from being achieved, each
 * with the id an agent passes to the station tools and what to do about it.
 * Same rule as the station blockers in `evaluateGoal`; this only spells out
 * the storage encoding of a judge rejection (`applyJudgeVerdict`): a claim
 * stays done+claim, a non-null `last_checked_at` means a judge already ruled
 * against it, and the reason sits in the note after `rejected: `.
 */
export function blockingStations(db: Database.Database, goalId: string): BlockingStation[] {
  const subtree = descendantIds(db, goalId);
  const placeholders = subtree.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT s.id, s.goal_id, s.name, s.status, s.evidence_kind, s.evidence_note, s.last_checked_at
       FROM pm_goal_stations s JOIN pm_goals g ON g.id = s.goal_id
       WHERE s.goal_id IN (${placeholders})
       ORDER BY g.sort_order, g.created_at, s.sort_order, s.created_at`
    )
    .all(...subtree) as {
    id: string;
    goal_id: string;
    name: string;
    status: string;
    evidence_kind: string;
    evidence_note: string;
    last_checked_at: string | null;
  }[];

  return rows.flatMap((row): BlockingStation[] => {
    const base = { stationId: row.id, goalId: row.goal_id, name: row.name };
    if (row.status !== 'done') return [{ ...base, state: row.status, reason: null }];
    if (isVerifiedEvidence(row.evidence_kind)) return [];
    if (row.last_checked_at === null) return [{ ...base, state: 'awaiting_judge', reason: null }];
    const note = row.evidence_note ?? '';
    return [
      {
        ...base,
        state: 'rejected_by_judge',
        reason: note.startsWith(REJECTED_PREFIX) ? note.slice(REJECTED_PREFIX.length) : note,
      },
    ];
  });
}

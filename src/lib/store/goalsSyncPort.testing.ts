/**
 * Test-only port of `goals_sync_impl` / `goals_load_impl`
 * (`src-tauri/src/database/goals.rs`) onto a real better-sqlite3 database.
 *
 * Why it exists: the lost-update question is about two writers on ONE SQLite
 * file — the store's save (through Rust) and the MCP server (TypeScript). A
 * vitest run cannot call Rust, so this port stands in for it, and it is kept
 * honest the same way the provider policy twins are: `goalsSync.fixtures.json`
 * is run against this port (`goalsSyncPort.test.ts`) and against the real Rust
 * code (`goals_sync_contract_tests.rs`), with the same expected rows. If the two
 * disagree, one of those tests fails before any conflict test can mislead.
 */
import type Database from 'better-sqlite3';

type Row = Record<string, unknown>;

/** Wire shape of the `goals_save` payload (camelCase, stations serialized). */
export interface GoalsSyncWire {
  goals: Row[];
  goalRuns: Row[];
  requirementLinks: Row[];
  stations?: Row[];
  deletedGoalIds?: string[];
  deletedRunIds?: string[];
  deletedLinkIds?: string[];
  deletedStationIds?: string[];
  baseGoals?: Row[];
  baseGoalRuns?: Row[];
  baseStations?: Row[];
}

const GOAL_COLUMNS = [
  'id',
  'parent_id',
  'name',
  'description',
  'success_criteria',
  'status',
  'priority',
  'goal_prompt',
  'created_by',
  'achieved_at',
  'sort_order',
  'created_at',
  'updated_at',
  'work_mode',
  'mission_path',
] as const;

const RUN_COLUMNS = [
  'id',
  'goal_id',
  'agent_id',
  'ticket_id',
  'prompt',
  'model',
  'provider',
  'source',
  'outcome',
  'summary',
  'started_at',
  'finished_at',
] as const;

const STATION_COLUMNS = [
  'id',
  'goal_id',
  'name',
  'kind',
  'status',
  'evidence_kind',
  'predicate',
  'evidence_note',
  'source_context',
  'ticket_id',
  'lane',
  'sort_order',
  'last_checked_at',
  'done_at',
  'created_at',
  'updated_at',
] as const;

const LINK_COLUMNS = ['id', 'goal_id', 'requirement_id', 'created_at'] as const;

const camel = (col: string): string => col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Mirrors serde defaults on the Rust side for fields a payload may omit. */
const WIRE_DEFAULTS: Record<string, unknown> = { workMode: 'auto', sourceContext: 'null' };

function wireValue(row: Row, col: string): unknown {
  const value = row[camel(col)];
  if (value === undefined) return WIRE_DEFAULTS[camel(col)] ?? null;
  return value;
}

// Update lists copied column for column from goals.rs — note which columns the
// Rust upsert leaves alone on conflict (created_at everywhere, started_at on runs).
const GOAL_UPDATE = GOAL_COLUMNS.filter((c) => c !== 'id' && c !== 'created_at');
const RUN_UPDATE = RUN_COLUMNS.filter((c) => c !== 'id' && c !== 'started_at');
const STATION_UPDATE = STATION_COLUMNS.filter((c) => c !== 'id' && c !== 'created_at');

function upsert(
  db: Database.Database,
  table: string,
  columns: readonly string[],
  updateColumns: readonly string[] | null,
  row: Row
): void {
  const placeholders = columns.map(() => '?').join(', ');
  const onConflict = updateColumns
    ? `DO UPDATE SET ${updateColumns.map((c) => `${c} = excluded.${c}`).join(', ')}`
    : 'DO NOTHING';
  db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) ${onConflict}`
  ).run(...columns.map((c) => wireValue(row, c)));
}

/** A row the sync left alone because the database changed the same columns. */
export interface GoalsSyncConflict {
  table: string;
  id: string;
  columns: string[];
}

/** Bookkeeping, rewritten by every edit on either side: never a clash. */
const NEVER_CLASHES = new Set(['updated_at']);

/**
 * Three-way write for a row that has a base: only columns whose payload value
 * differs from the base are written, and a row that is gone stays gone. It is a
 * compare-and-swap: if any of those columns now holds a third value in the
 * database, the row is left untouched and reported instead.
 */
function updateChanged(
  db: Database.Database,
  table: string,
  columns: readonly string[],
  row: Row,
  base: Row
): GoalsSyncConflict | null {
  const changed = columns.filter((c) => c !== 'id' && wireValue(row, c) !== wireValue(base, c));
  if (changed.length === 0) return null;
  const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as Row | undefined;
  if (!current) return null;
  const clashing = changed
    .filter((c) => !NEVER_CLASHES.has(c))
    .filter((c) => current[c] !== wireValue(base, c) && current[c] !== wireValue(row, c))
    .sort();
  if (clashing.length > 0) return { table, id: String(row.id), columns: clashing };
  db.prepare(`UPDATE ${table} SET ${changed.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    ...changed.map((c) => wireValue(row, c)),
    row.id
  );
  return null;
}

function writeRows(
  db: Database.Database,
  table: string,
  columns: readonly string[],
  updateColumns: readonly string[],
  rows: Row[],
  bases: Row[] | undefined
): GoalsSyncConflict[] {
  const baseById = new Map((bases ?? []).map((b) => [b.id, b]));
  const conflicts: GoalsSyncConflict[] = [];
  for (const row of rows) {
    const base = baseById.get(row.id);
    if (!base) {
      upsert(db, table, columns, updateColumns, row);
      continue;
    }
    const conflict = updateChanged(db, table, columns, row, base);
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}

/** Port of `goals_sync_impl`. */
export function goalsSyncPort(
  db: Database.Database,
  payload: GoalsSyncWire
): { conflicts: GoalsSyncConflict[] } {
  return db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    const del = (table: string, ids: string[] | undefined) => {
      for (const id of ids ?? []) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    };
    del('pm_goals', payload.deletedGoalIds);
    del('pm_goal_runs', payload.deletedRunIds);
    del('pm_goal_requirement_links', payload.deletedLinkIds);
    del('pm_goal_stations', payload.deletedStationIds);

    const conflicts = [
      ...writeRows(db, 'pm_goals', GOAL_COLUMNS, GOAL_UPDATE, payload.goals, payload.baseGoals),
      ...writeRows(
        db,
        'pm_goal_runs',
        RUN_COLUMNS,
        RUN_UPDATE,
        payload.goalRuns,
        payload.baseGoalRuns
      ),
    ];
    for (const link of payload.requirementLinks) {
      upsert(db, 'pm_goal_requirement_links', LINK_COLUMNS, null, link);
    }
    conflicts.push(
      ...writeRows(
        db,
        'pm_goal_stations',
        STATION_COLUMNS,
        STATION_UPDATE,
        payload.stations ?? [],
        payload.baseStations
      )
    );
    return { conflicts };
  })();
}

function select(db: Database.Database, table: string, columns: readonly string[], order: string) {
  const rows = db
    .prepare(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${order}`)
    .all() as Row[];
  return rows.map((r) => Object.fromEntries(columns.map((c) => [camel(c), r[c]])));
}

/** Port of `goals_load_impl`, returning the wire shape `goalsLoad` parses. */
export function goalsLoadPort(db: Database.Database) {
  return {
    goals: select(db, 'pm_goals', GOAL_COLUMNS, 'sort_order, created_at'),
    goalRuns: select(db, 'pm_goal_runs', RUN_COLUMNS, 'started_at'),
    requirementLinks: select(db, 'pm_goal_requirement_links', LINK_COLUMNS, 'created_at'),
    stations: select(db, 'pm_goal_stations', STATION_COLUMNS, 'goal_id, sort_order, created_at'),
  };
}

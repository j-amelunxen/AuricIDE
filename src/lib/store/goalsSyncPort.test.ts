/**
 * Runs the shared goals-sync cases against the test port. The same file is run
 * against the real Rust code in `goals_sync_contract_tests.rs`; together they
 * keep the port that the conflict tests rely on equal to what ships.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../mcp/db';
import { goalsSyncPort, type GoalsSyncWire } from './goalsSyncPort.testing';
import fixtures from './goalsSync.fixtures.json';

type Row = Record<string, unknown>;
interface ConcurrentOp {
  table: string;
  id: string;
  set?: Record<string, unknown>;
  delete?: boolean;
}
interface SyncCase {
  name: string;
  seed: { goals?: Row[]; stations?: Row[]; goalRuns?: Row[] };
  concurrent?: ConcurrentOp[];
  payload: Partial<GoalsSyncWire>;
  expect?: Record<string, Record<string, Row>>;
  absent?: Record<string, string[]>;
  conflicts?: { table: string; id: string; columns: string[] }[];
}

const { defaults } = fixtures;
const cases = fixtures.cases as SyncCase[];

function withDefaults(payload: Partial<GoalsSyncWire>): GoalsSyncWire {
  return {
    ...payload,
    goals: (payload.goals ?? []).map((g) => ({ ...defaults.goal, ...g })),
    goalRuns: (payload.goalRuns ?? []).map((r) => ({ ...defaults.run, ...r })),
    requirementLinks: payload.requirementLinks ?? [],
    stations: (payload.stations ?? []).map((s) => ({ ...defaults.station, ...s })),
    baseGoals: (payload.baseGoals ?? []).map((g) => ({ ...defaults.goal, ...g })),
    baseGoalRuns: (payload.baseGoalRuns ?? []).map((r) => ({ ...defaults.run, ...r })),
    baseStations: (payload.baseStations ?? []).map((s) => ({ ...defaults.station, ...s })),
  };
}

function applyConcurrent(db: Database.Database, op: ConcurrentOp): void {
  if (op.delete) {
    db.prepare(`DELETE FROM ${op.table} WHERE id = ?`).run(op.id);
    return;
  }
  const cols = Object.keys(op.set ?? {});
  db.prepare(`UPDATE ${op.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    ...cols.map((c) => op.set![c]),
    op.id
  );
}

describe('goals sync port matches the shared cases', () => {
  let db: Database.Database;
  afterEach(() => db?.close());

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    db = createTestDb();
    goalsSyncPort(db, withDefaults(c.seed));
    for (const op of c.concurrent ?? []) applyConcurrent(db, op);
    const result = goalsSyncPort(db, withDefaults(c.payload));
    expect(result.conflicts, 'conflicts').toEqual(c.conflicts ?? []);

    for (const [table, byId] of Object.entries(c.expect ?? {})) {
      for (const [id, columns] of Object.entries(byId)) {
        const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
        expect(row, `${table}/${id}`).toBeDefined();
        expect(row).toMatchObject(columns);
      }
    }
    for (const [table, ids] of Object.entries(c.absent ?? {})) {
      for (const id of ids) {
        expect(db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id), `${table}/${id}`).toBe(
          undefined
        );
      }
    }
  });
});

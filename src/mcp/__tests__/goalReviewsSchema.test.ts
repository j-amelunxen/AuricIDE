import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import contract from '../../lib/goals/goalReviewsSchema.fixtures.json';
import { createTestDb, runMigrations } from '../db';

// The same contract drives src-tauri/src/database/tests/schema_tests.rs, so the
// MCP migration and the Rust migration cannot drift into two different tables.

function seedGoal(db: Database.Database, id = 'goal-1') {
  db.prepare("INSERT INTO pm_goals (id, name) VALUES (?, 'G')").run(id);
}

function insertReview(db: Database.Database, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO pm_goal_reviews (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`
  ).run(row);
}

describe('pm_goal_reviews (migration 21)', () => {
  it('has exactly the columns of the shared contract', () => {
    const db = createTestDb();
    const columns = (
      db.prepare('PRAGMA table_info(pm_goal_reviews)').all() as {
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }[]
    ).map((c) => ({ name: c.name, type: c.type, notnull: c.notnull === 1, pk: c.pk > 0 }));
    expect(columns).toEqual(contract.columns);
    db.close();
  });

  it('is recorded under the contract id and name', () => {
    const db = createTestDb();
    const row = db
      .prepare('SELECT name FROM _migrations WHERE id = ?')
      .get(contract.migration.id) as { name: string } | undefined;
    expect(row?.name).toBe(contract.migration.name);
    db.close();
  });

  it('stores a valid review and defaults created_at', () => {
    const db = createTestDb();
    seedGoal(db);
    insertReview(db, contract.validRow);
    const stored = db.prepare('SELECT * FROM pm_goal_reviews').get() as Record<string, unknown>;
    expect(stored).toMatchObject(contract.validRow);
    expect(stored.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    db.close();
  });

  it.each(contract.rejectedRows.map((r) => [r.case, r.set] as const))(
    'rejects a row with %s',
    (_case, set) => {
      const db = createTestDb();
      seedGoal(db);
      expect(() => insertReview(db, { ...contract.validRow, ...set })).toThrow();
      expect(db.prepare('SELECT COUNT(*) AS n FROM pm_goal_reviews').get()).toEqual({ n: 0 });
      db.close();
    }
  );

  it('keeps one review per goal and attempt', () => {
    const db = createTestDb();
    seedGoal(db);
    insertReview(db, contract.validRow);
    expect(() => insertReview(db, { ...contract.validRow, id: 'rev-2' })).toThrow(/UNIQUE/);
    insertReview(db, { ...contract.validRow, id: 'rev-2', attempt: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM pm_goal_reviews').get()).toEqual({ n: 2 });
    db.close();
  });

  it('removes the reviews with their goal', () => {
    const db = createTestDb();
    seedGoal(db);
    insertReview(db, contract.validRow);
    db.prepare('DELETE FROM pm_goals WHERE id = ?').run('goal-1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM pm_goal_reviews').get()).toEqual({ n: 0 });
    db.close();
  });

  // Fault injection: schema written, marker 21 missing (or index missing too).
  // The next open must finish the migration rather than fail on "already exists".
  it.each([
    ['table and index', ''],
    ['table without index', 'DROP INDEX idx_goal_reviews_goal;'],
  ])('recovers from a crash before marker 21 with %s left behind', (_label, leftover) => {
    const db = createTestDb();
    db.exec(`${leftover} DELETE FROM _migrations WHERE id = ${contract.migration.id};`);
    runMigrations(db);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM _migrations WHERE id = ?').get(contract.migration.id)
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_goal_reviews_goal')
    ).toEqual({ n: 1 });
    db.close();
  });

  it('upgrades a database from before migration 21 without touching its goals or ticket reviews', () => {
    const db = createTestDb();
    // Roll the database back to the state an existing project has today.
    db.exec(
      `DROP TABLE pm_goal_reviews; DELETE FROM _migrations WHERE id = ${contract.migration.id};`
    );
    seedGoal(db);
    db.exec(`
      INSERT INTO pm_epics (id, name) VALUES ('e1', 'E');
      INSERT INTO pm_tickets (id, epic_id, name) VALUES ('t1', 'e1', 'T');
      INSERT INTO pm_ticket_reviews (id, ticket_id, verdict, reason) VALUES ('tr1', 't1', 1, 'ok');
    `);
    runMigrations(db);
    runMigrations(db);
    insertReview(db, contract.validRow);
    expect(db.prepare('SELECT name FROM pm_goals').all()).toEqual([{ name: 'G' }]);
    expect(db.prepare('SELECT id, verdict, reason FROM pm_ticket_reviews').all()).toEqual([
      { id: 'tr1', verdict: 1, reason: 'ok' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pm_goal_reviews').get()).toEqual({ n: 1 });
    db.close();
  });
});

import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { createTestNotificationsDb } from '../notificationsDb';
import schemas from '../dbSchemas.fixtures.json';

function objectsOf(db: Database.Database) {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all() as { type: string; name: string; sql: string | null }[];
  return rows.map((o) => ({
    type: o.type,
    name: o.name,
    sql: (o.sql ?? '').replace(/\s+/g, ' ').trim(),
  }));
}

// The IDE (Rust) migrates the same databases; both suites compare a fresh
// one with the shared fixture (src-tauri/src/database/tests/schema_snapshot_tests.rs).
describe('database schemas shared with the IDE', () => {
  it.each([
    ['project.db', createTestDb, schemas.project],
    ['notifications.db', createTestNotificationsDb, schemas.notifications],
  ] as const)('%s is the shared one, apart from what only the IDE creates', (_, open, schema) => {
    expect(objectsOf(open())).toEqual(
      schema.objects.filter((o) => !(schema.rustOnly as readonly string[]).includes(o.name))
    );
  });
});

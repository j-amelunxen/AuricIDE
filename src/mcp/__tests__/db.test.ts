import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, openDatabase } from '../db';

describe('openDatabase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-db-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a better-sqlite3 Database instance', () => {
    const dbPath = join(tempDir, 'test.db');
    const db = openDatabase(dbPath);
    expect(db).toBeInstanceOf(Database);
    db.close();
  });

  it('enables WAL journal mode', () => {
    const dbPath = join(tempDir, 'test.db');
    const db = openDatabase(dbPath);
    const result = db.pragma('journal_mode', { simple: true });
    expect(result).toBe('wal');
    db.close();
  });

  it('enables foreign keys', () => {
    const dbPath = join(tempDir, 'test.db');
    const db = openDatabase(dbPath);
    const result = db.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
    db.close();
  });

  it('creates all required tables on fresh database', () => {
    const dbPath = join(tempDir, 'test.db');
    const db = openDatabase(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('_migrations');
    expect(tableNames).toContain('kv_store');
    expect(tableNames).toContain('pm_epics');
    expect(tableNames).toContain('pm_tickets');
    expect(tableNames).toContain('pm_test_cases');
    expect(tableNames).toContain('pm_dependencies');
    expect(tableNames).toContain('pm_status_history');
    expect(tableNames).toContain('blueprints');
    expect(tableNames).toContain('pm_requirements');
    expect(tableNames).toContain('pm_requirement_test_links');
    db.close();
  });

  it('records all 12 migrations', () => {
    const dbPath = join(tempDir, 'test.db');
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(12);
    db.close();
  });

  it('is idempotent — opening same DB twice causes no error', () => {
    const dbPath = join(tempDir, 'test.db');
    const db1 = openDatabase(dbPath);
    db1.close();
    const db2 = openDatabase(dbPath);
    const row = db2.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(12);
    db2.close();
  });

  it('works when Rust has already migrated (pre-existing migration rows)', () => {
    const dbPath = join(tempDir, 'test.db');
    // Simulate Rust having already run all migrations
    const setup = new Database(dbPath);
    setup.pragma('journal_mode = WAL');
    setup.pragma('foreign_keys = ON');
    setup.exec(`
      CREATE TABLE _migrations (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    for (let i = 1; i <= 12; i++) {
      setup
        .prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')
        .run(i, `rust_migration_${i}`);
    }
    // Create the tables that Rust would have created
    setup.exec(`
      CREATE TABLE kv_store (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (namespace, key));
      CREATE TABLE pm_epics (id TEXT PRIMARY KEY, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE pm_tickets (id TEXT PRIMARY KEY,
        epic_id TEXT NOT NULL REFERENCES pm_epics(id) ON DELETE CASCADE,
        name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open', sort_order INTEGER NOT NULL DEFAULT 0,
        context TEXT NOT NULL DEFAULT '[]',
        status_updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
        working_directory TEXT, priority TEXT NOT NULL DEFAULT 'normal', model_power TEXT,
        needs_human_supervision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE pm_test_cases (id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
        title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE pm_dependencies (id TEXT PRIMARY KEY, source_type TEXT NOT NULL,
        source_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
        UNIQUE(source_id, target_id));
      CREATE TABLE pm_status_history (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL,
        from_status TEXT, to_status TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT NOT NULL DEFAULT 'ui');
      CREATE TABLE blueprints (id TEXT PRIMARY KEY, name TEXT NOT NULL,
        tech_stack TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '',
        complexity TEXT NOT NULL DEFAULT 'MEDIUM', category TEXT NOT NULL DEFAULT 'architectures',
        description TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE pm_requirements (id TEXT PRIMARY KEY, req_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'functional', category TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'draft',
        rationale TEXT NOT NULL DEFAULT '', acceptance_criteria TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
        applies_to TEXT NOT NULL DEFAULT '[]', last_verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE pm_requirement_test_links (id TEXT PRIMARY KEY,
        requirement_id TEXT NOT NULL REFERENCES pm_requirements(id) ON DELETE CASCADE,
        test_case_id TEXT NOT NULL REFERENCES pm_test_cases(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(requirement_id, test_case_id));
    `);
    setup.close();

    // Now open with our migrations — should not fail
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(12);
    db.close();
  });
});

describe('createTestDb', () => {
  it('creates an in-memory database with all tables', () => {
    const db = createTestDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('pm_epics');
    expect(tableNames).toContain('pm_tickets');
    expect(tableNames).toContain('pm_requirements');
    expect(tableNames).toContain('pm_requirement_test_links');
    db.close();
  });
});

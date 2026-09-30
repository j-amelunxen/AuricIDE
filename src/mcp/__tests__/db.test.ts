import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, openDatabase, runMigrations } from '../db';

const concurrentOpenWorker = `
  import { existsSync, writeFileSync } from 'node:fs';
  import { openDatabase } from './src/mcp/db.ts';

  writeFileSync(process.env.AURIC_READY_PATH, '');
  while (!existsSync(process.env.AURIC_START_PATH)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const db = openDatabase(process.env.AURIC_DB_PATH);
  db.close();
`;

async function waitForFiles(paths: string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for concurrent database workers');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

  it('records all 24 migrations (ids 1-13, 15-25; 14 is Rust-only)', () => {
    const dbPath = join(tempDir, 'test.db');
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(24);
    const stationRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 15')
      .get() as { cnt: number };
    expect(stationRow.cnt).toBe(1);
    const reviewsRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 16')
      .get() as { cnt: number };
    expect(reviewsRow.cnt).toBe(1);
    const contextRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 17')
      .get() as { cnt: number };
    expect(contextRow.cnt).toBe(1);
    const dueDateRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 18')
      .get() as { cnt: number };
    expect(dueDateRow.cnt).toBe(1);
    const skillsRow = db.prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 19').get() as {
      cnt: number;
    };
    expect(skillsRow.cnt).toBe(1);
    const workModeRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 20')
      .get() as { cnt: number };
    expect(workModeRow.cnt).toBe(1);
    const missionPathRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM _migrations WHERE id = 22')
      .get() as { cnt: number };
    expect(missionPathRow.cnt).toBe(1);
    db.close();
  });

  it('creates pm_agent_usage with the contract columns and indexes (migration 25)', () => {
    const db = openDatabase(join(tempDir, 'test.db'));
    const columns = (
      db.prepare('PRAGMA table_info(pm_agent_usage)').all() as { name: string; notnull: number }[]
    ).map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'agent_id',
        'ticket_id',
        'goal_id',
        'run_kind',
        'cost_usd',
        'cost_source',
        'estimate_cost_usd',
        'unpriced_models',
        'model_usage_json',
        'num_turns',
      ])
    );
    expect(columns).toHaveLength(31);
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((i) => i.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_pm_agent_usage_ticket',
        'idx_pm_agent_usage_goal',
        'idx_pm_agent_usage_started',
      ])
    );
    expect(db.prepare('SELECT name FROM _migrations WHERE id = 25').get()).toEqual({
      name: 'create_pm_agent_usage',
    });
    db.close();
  });

  it('keeps a usage row after its ticket is deleted (no foreign key)', () => {
    const db = openDatabase(join(tempDir, 'test.db'));
    db.prepare(
      `INSERT INTO pm_agent_usage (id, agent_id, ticket_id, run_kind, run_source, provider,
        started_at, finished_at, duration_ms, outcome, cost_source)
       VALUES ('u1', 'a1', 'gone-ticket', 'ticket', 'ui', 'claude',
        '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 60000, 'success', 'none')`
    ).run();
    const row = db.prepare('SELECT cost_usd, headless, match_kind FROM pm_agent_usage').get();
    expect(row).toEqual({ cost_usd: null, headless: 0, match_kind: 'exact' });
    db.close();
  });

  it('backfills one snapshot per existing goal (migration 24, twin of the Rust one)', () => {
    const db = openDatabase(join(tempDir, 'test.db'));
    // Roll back to before 24 and seed goals as an older app left them.
    db.exec(`
      DROP TABLE pm_goal_status_history;
      DELETE FROM _migrations WHERE id = 24;
      INSERT INTO pm_goals (id, name, status, updated_at)
        VALUES ('open', 'Open', 'in_progress', '2026-09-01 10:00:00');
      INSERT INTO pm_goals (id, name, status, achieved_at, updated_at)
        VALUES ('done', 'Done', 'achieved', '2026-08-01 09:00:00', '2026-08-05 09:00:00');
    `);
    runMigrations(db);
    // A second run must not add a second snapshot.
    db.exec('DELETE FROM _migrations WHERE id = 24');
    runMigrations(db);

    const rows = db
      .prepare(
        'SELECT goal_id, from_status, to_status, changed_at, source FROM pm_goal_status_history ORDER BY goal_id'
      )
      .all();
    expect(rows).toEqual([
      {
        goal_id: 'done',
        from_status: null,
        to_status: 'achieved',
        changed_at: '2026-08-01 09:00:00',
        source: 'backfill',
      },
      {
        goal_id: 'open',
        from_status: null,
        to_status: 'in_progress',
        changed_at: '2026-09-01 10:00:00',
        source: 'backfill',
      },
    ]);
    db.close();
  });

  it('adds a nullable mission_path to goals (migration 22, twin of the Rust one)', () => {
    const db = openDatabase(join(tempDir, 'test.db'));
    const cols = db.prepare('PRAGMA table_info(pm_goals)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(cols.find((c) => c.name === 'mission_path')).toMatchObject({
      notnull: 0,
      dflt_value: null,
    });
    const name = db.prepare('SELECT name FROM _migrations WHERE id = 22').get() as {
      name: string;
    };
    expect(name.name).toBe('add_goal_mission_path');
    db.close();
  });

  it('adds pm_goal_dependencies and a nullable bundle column on goals (migration 23)', () => {
    const db = openDatabase(join(tempDir, 'test.db'));
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'pm_goal_dependencies'"
      )
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const cols = db.prepare('PRAGMA table_info(pm_goals)').all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    expect(cols.find((c) => c.name === 'bundle')).toMatchObject({ notnull: 0, dflt_value: null });

    const name = db.prepare('SELECT name FROM _migrations WHERE id = 23').get() as {
      name: string;
    };
    expect(name.name).toBe('goal_dependencies');

    db.prepare("INSERT INTO pm_goals (id, name, status) VALUES ('g1', 'Goal', 'active')").run();
    db.prepare("INSERT INTO pm_goals (id, name, status) VALUES ('g2', 'Other', 'active')").run();
    // created_at has no DEFAULT (matches the Rust twin: the caller always
    // supplies it, since the frontend/MCP payload owns the timestamp).
    expect(() =>
      db
        .prepare(
          `INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id) VALUES ('d0', 'g1', 'g2')`
        )
        .run()
    ).toThrow(/NOT NULL/);
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id, created_at) VALUES ('d1', 'g1', 'g2', ?)`
    ).run(ts);
    expect(() =>
      db
        .prepare(
          `INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id, created_at) VALUES ('d2', 'g1', 'g2', ?)`
        )
        .run(ts)
    ).toThrow();
    db.close();
  });

  it('is idempotent — opening same DB twice causes no error', () => {
    const dbPath = join(tempDir, 'test.db');
    const db1 = openDatabase(dbPath);
    db1.close();
    const db2 = openDatabase(dbPath);
    const row = db2.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(24);
    db2.close();
  });

  it('serializes simultaneous first opens from independent client processes', async () => {
    const dbPath = join(tempDir, 'test.db');
    const startPath = join(tempDir, 'start');
    const readyPaths = Array.from({ length: 12 }, (_, index) => join(tempDir, `ready-${index}`));
    const workers = readyPaths.map(
      (readyPath) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--import', 'tsx', '--input-type=module', '--eval', concurrentOpenWorker],
            {
              cwd: process.cwd(),
              env: {
                ...process.env,
                AURIC_DB_PATH: dbPath,
                AURIC_READY_PATH: readyPath,
                AURIC_START_PATH: startPath,
              },
              stdio: ['ignore', 'ignore', 'pipe'],
            }
          );
          let stderr = '';
          child.stderr.setEncoding('utf8');
          child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Concurrent database worker exited ${code}: ${stderr}`));
            }
          });
        })
    );

    await waitForFiles(readyPaths);
    writeFileSync(startPath, '');
    await Promise.all(workers);

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(24);
    db.close();
  }, 20_000);

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

    // Now open with our migrations — the JS side applies the missing
    // #13 and #15-#25 on top
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM _migrations').get() as { cnt: number };
    expect(row.cnt).toBe(24);
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

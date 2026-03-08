import Database from 'better-sqlite3';

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = (id: number): boolean => {
    const row = db.prepare('SELECT COUNT(*) > 0 AS ok FROM _migrations WHERE id = ?').get(id) as {
      ok: number;
    };
    return row.ok === 1;
  };

  const record = (id: number, name: string): void => {
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(id, name);
  };

  // Migration #1: kv_store
  if (!applied(1)) {
    db.exec(`
      CREATE TABLE kv_store (
        namespace  TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key)
      );
    `);
    record(1, 'create_kv_store');
  }

  // Migration #2: PM tables
  if (!applied(2)) {
    db.exec(`
      CREATE TABLE pm_epics (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE pm_tickets (
        id          TEXT PRIMARY KEY,
        epic_id     TEXT NOT NULL REFERENCES pm_epics(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'open',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_tickets_epic ON pm_tickets(epic_id);

      CREATE TABLE pm_test_cases (
        id          TEXT PRIMARY KEY,
        ticket_id   TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_test_cases_ticket ON pm_test_cases(ticket_id);

      CREATE TABLE pm_dependencies (
        id          TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id   TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        UNIQUE(source_id, target_id)
      );
      CREATE INDEX idx_deps_source ON pm_dependencies(source_id);
      CREATE INDEX idx_deps_target ON pm_dependencies(target_id);
    `);
    record(2, 'create_pm_tables');
  }

  // Migration #3: Add context to pm_tickets
  if (!applied(3)) {
    db.exec("ALTER TABLE pm_tickets ADD COLUMN context TEXT NOT NULL DEFAULT '[]'");
    record(3, 'add_ticket_context');
  }

  // Migration #4: Add status_updated_at and working_directory to pm_tickets
  if (!applied(4)) {
    db.exec(`
      ALTER TABLE pm_tickets ADD COLUMN status_updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00';
      ALTER TABLE pm_tickets ADD COLUMN working_directory TEXT;
    `);
    record(4, 'add_status_updated_at_working_directory');
  }

  // Migration #5: Add priority to pm_tickets
  if (!applied(5)) {
    db.exec("ALTER TABLE pm_tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'");
    record(5, 'add_ticket_priority');
  }

  // Migration #6: Add model_power to pm_tickets
  if (!applied(6)) {
    db.exec('ALTER TABLE pm_tickets ADD COLUMN model_power TEXT');
    record(6, 'add_ticket_model_power');
  }

  // Migration #7: Add needs_human_supervision to pm_tickets
  if (!applied(7)) {
    db.exec('ALTER TABLE pm_tickets ADD COLUMN needs_human_supervision INTEGER NOT NULL DEFAULT 0');
    record(7, 'add_ticket_needs_human_supervision');
  }

  // Migration #8: pm_status_history table
  if (!applied(8)) {
    db.exec(`
      CREATE TABLE pm_status_history (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT NOT NULL DEFAULT 'ui'
      );
      CREATE INDEX idx_status_history_ticket ON pm_status_history(ticket_id);

      -- Backfill creation events
      INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
      SELECT hex(randomblob(16)), id, NULL,
        CASE WHEN status IN ('done','archived','in_progress') THEN 'open' ELSE status END,
        created_at, 'backfill'
      FROM pm_tickets;

      -- Backfill current-status events for non-open tickets
      INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
      SELECT hex(randomblob(16)), id, 'open', status, status_updated_at, 'backfill'
      FROM pm_tickets WHERE status != 'open';
    `);
    record(8, 'create_pm_status_history');
  }

  // Migration #9: Blueprints table
  if (!applied(9)) {
    db.exec(`
      CREATE TABLE blueprints (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        tech_stack  TEXT NOT NULL DEFAULT '',
        goal        TEXT NOT NULL DEFAULT '',
        complexity  TEXT NOT NULL DEFAULT 'MEDIUM',
        category    TEXT NOT NULL DEFAULT 'architectures',
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_blueprints_category ON blueprints(category);
    `);
    record(9, 'create_blueprints');
  }

  // Migration #10: Add spec column to blueprints
  if (!applied(10)) {
    db.exec("ALTER TABLE blueprints ADD COLUMN spec TEXT NOT NULL DEFAULT ''");
    record(10, 'blueprints_add_spec');
  }

  // Migration #11: Requirements table
  if (!applied(11)) {
    db.exec(`
      CREATE TABLE pm_requirements (
        id                  TEXT PRIMARY KEY,
        req_id              TEXT NOT NULL UNIQUE,
        title               TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        type                TEXT NOT NULL DEFAULT 'functional',
        category            TEXT NOT NULL DEFAULT '',
        priority            TEXT NOT NULL DEFAULT 'normal',
        status              TEXT NOT NULL DEFAULT 'draft',
        rationale           TEXT NOT NULL DEFAULT '',
        acceptance_criteria TEXT NOT NULL DEFAULT '',
        source              TEXT NOT NULL DEFAULT '',
        sort_order          INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_pm_requirements_req_id ON pm_requirements(req_id);
    `);
    record(11, 'create_pm_requirements');
  }

  // Migration #12: applies_to, last_verified_at, pm_requirement_test_links
  if (!applied(12)) {
    db.exec(`
      ALTER TABLE pm_requirements ADD COLUMN applies_to TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE pm_requirements ADD COLUMN last_verified_at TEXT;
      CREATE TABLE pm_requirement_test_links (
        id              TEXT PRIMARY KEY,
        requirement_id  TEXT NOT NULL REFERENCES pm_requirements(id) ON DELETE CASCADE,
        test_case_id    TEXT NOT NULL REFERENCES pm_test_cases(id) ON DELETE CASCADE,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(requirement_id, test_case_id)
      );
      CREATE INDEX idx_req_test_links_req ON pm_requirement_test_links(requirement_id);
      CREATE INDEX idx_req_test_links_tc ON pm_requirement_test_links(test_case_id);
    `);
    record(12, 'requirements_applies_to_test_links');
  }
}

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export { runMigrations };

import Database from 'better-sqlite3';

export interface SqliteDbOptions {
  wal?: boolean;
  foreignKeys?: boolean;
}

/**
 * Opens a SQLite database at the specified path and configures common pragmas.
 */
export function openSqliteDb(
  path: string,
  options: SqliteDbOptions = { wal: true }
): Database.Database {
  const db = new Database(path);
  if (options.wal ?? true) {
    db.pragma('journal_mode = WAL');
  }
  if (options.foreignKeys !== undefined) {
    db.pragma(`foreign_keys = ${options.foreignKeys ? 'ON' : 'OFF'}`);
  }
  return db;
}

/**
 * Creates an in-memory SQLite database for testing or ephemeral storage.
 */
export function createInMemorySqliteDb(options: SqliteDbOptions = {}): Database.Database {
  const db = new Database(':memory:');
  if (options.foreignKeys !== undefined) {
    db.pragma(`foreign_keys = ${options.foreignKeys ? 'ON' : 'OFF'}`);
  }
  return db;
}

export interface MigrationTracker {
  applied: (id: number) => boolean;
  record: (id: number, name: string) => void;
}

/**
 * Ensures the `_migrations` tracking table exists and returns helpers
 * to check whether a migration has been applied and record a new migration.
 */
export function initMigrationTable(db: Database.Database): MigrationTracker {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const countStmt = db.prepare('SELECT COUNT(*) > 0 AS ok FROM _migrations WHERE id = ?');
  const insertStmt = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');

  return {
    applied: (id: number): boolean => {
      const row = countStmt.get(id) as { ok: number };
      return row.ok === 1;
    },
    record: (id: number, name: string): void => {
      insertStmt.run(id, name);
    },
  };
}

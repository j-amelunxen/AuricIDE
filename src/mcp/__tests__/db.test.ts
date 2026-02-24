import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';

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

  it('can query existing pm_epics table', () => {
    // First create a DB with the schema via Rust's init_db (simulate by creating tables)
    const dbPath = join(tempDir, 'test.db');
    const setupDb = new Database(dbPath);
    setupDb.exec(`
      CREATE TABLE pm_epics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    setupDb.close();

    const db = openDatabase(dbPath);
    const rows = db.prepare('SELECT COUNT(*) as count FROM pm_epics').get() as { count: number };
    expect(rows.count).toBe(0);
    db.close();
  });
});

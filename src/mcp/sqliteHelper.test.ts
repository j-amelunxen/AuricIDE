import { describe, expect, it } from 'vitest';
import { createInMemorySqliteDb, openSqliteDb, initMigrationTable } from './sqliteHelper';

describe('sqliteHelper', () => {
  describe('createInMemorySqliteDb', () => {
    it('creates an in-memory SQLite database and applies foreign keys option', () => {
      const dbOff = createInMemorySqliteDb({ foreignKeys: false });
      const rowOff = dbOff.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(rowOff[0]?.foreign_keys).toBe(0);
      dbOff.close();

      const dbOn = createInMemorySqliteDb({ foreignKeys: true });
      const rowOn = dbOn.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(rowOn[0]?.foreign_keys).toBe(1);
      dbOn.close();
    });
  });

  describe('openSqliteDb', () => {
    it('creates a database and applies options', () => {
      const db = openSqliteDb(':memory:', { wal: true, foreignKeys: true });
      const fk = db.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(fk[0]?.foreign_keys).toBe(1);
      db.close();
    });
  });

  describe('initMigrationTable', () => {
    it('initializes _migrations and tracks migration applications', () => {
      const db = createInMemorySqliteDb();
      const tracker = initMigrationTable(db);

      expect(tracker.applied(1)).toBe(false);
      tracker.record(1, 'migration_one');
      expect(tracker.applied(1)).toBe(true);

      const rows = db.prepare('SELECT * FROM _migrations WHERE id = ?').all(1) as {
        id: number;
        name: string;
        applied_at: string;
      }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('migration_one');
      expect(rows[0]?.applied_at).toBeDefined();

      db.close();
    });
  });
});

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  importRequirements,
} from './requirements';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
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
  return db;
}

describe('requirement MCP tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  describe('listRequirements', () => {
    it('returns empty array when no requirements exist', () => {
      expect(listRequirements(db)).toEqual([]);
    });

    it('returns all requirements ordered by sort_order then req_id', () => {
      createRequirement(db, { reqId: 'REQ-B-01', title: 'Beta' });
      createRequirement(db, { reqId: 'REQ-A-01', title: 'Alpha' });
      const result = listRequirements(db);
      expect(result).toHaveLength(2);
      expect(result[0].req_id).toBe('REQ-A-01');
      expect(result[1].req_id).toBe('REQ-B-01');
    });

    it('filters by type', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'Func', type: 'functional' });
      createRequirement(db, { reqId: 'REQ-02', title: 'NFR', type: 'non_functional' });
      const result = listRequirements(db, { type: 'functional' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Func');
    });

    it('filters by category', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'Auth', category: 'auth' });
      createRequirement(db, { reqId: 'REQ-02', title: 'Perf', category: 'performance' });
      const result = listRequirements(db, { category: 'auth' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Auth');
    });

    it('filters by status', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'Draft', status: 'draft' });
      createRequirement(db, { reqId: 'REQ-02', title: 'Active', status: 'active' });
      const result = listRequirements(db, { status: 'active' });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Active');
    });

    it('combines multiple filters', () => {
      createRequirement(db, {
        reqId: 'REQ-01',
        title: 'Match',
        type: 'functional',
        category: 'auth',
        status: 'active',
      });
      createRequirement(db, {
        reqId: 'REQ-02',
        title: 'No Match',
        type: 'functional',
        category: 'auth',
        status: 'draft',
      });
      const result = listRequirements(db, {
        type: 'functional',
        category: 'auth',
        status: 'active',
      });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Match');
    });
  });

  describe('getRequirement', () => {
    it('returns null for non-existent ID', () => {
      expect(getRequirement(db, 'nope')).toBeNull();
    });

    it('returns the requirement by ID', () => {
      const created = createRequirement(db, {
        reqId: 'REQ-AUTH-01',
        title: 'Login',
        category: 'auth',
      });
      const result = getRequirement(db, created.id);
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Login');
      expect(result!.req_id).toBe('REQ-AUTH-01');
    });
  });

  describe('createRequirement', () => {
    it('creates a requirement with defaults', () => {
      const result = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      expect(result.req_id).toBe('REQ-01');
      expect(result.title).toBe('Test');
      expect(result.type).toBe('functional');
      expect(result.priority).toBe('normal');
      expect(result.status).toBe('draft');
      expect(result.id).toBeTruthy();
    });

    it('creates with all fields', () => {
      const result = createRequirement(db, {
        reqId: 'REQ-AUTH-01',
        title: 'Login',
        description: '# Login\nUsers login',
        type: 'functional',
        category: 'auth',
        priority: 'critical',
        status: 'active',
        rationale: 'Core feature',
        acceptanceCriteria: '- Can login',
        source: 'spec.md',
        sortOrder: 5,
      });
      expect(result.req_id).toBe('REQ-AUTH-01');
      expect(result.category).toBe('auth');
      expect(result.priority).toBe('critical');
      expect(result.sort_order).toBe(5);
    });

    it('persists to database', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Persist' });
      const fetched = getRequirement(db, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe('Persist');
    });
  });

  describe('updateRequirement', () => {
    it('updates specified fields', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Old' });
      const updated = updateRequirement(db, created.id, { title: 'New', priority: 'high' });
      expect(updated.title).toBe('New');
      expect(updated.priority).toBe('high');
    });

    it('throws on non-existent ID', () => {
      expect(() => updateRequirement(db, 'nonexistent', { title: 'X' })).toThrow();
    });

    it('returns existing if no updates provided', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Same' });
      const result = updateRequirement(db, created.id, {});
      expect(result.title).toBe('Same');
    });
  });

  describe('deleteRequirement', () => {
    it('returns true when requirement exists', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Del' });
      expect(deleteRequirement(db, created.id)).toBe(true);
      expect(getRequirement(db, created.id)).toBeNull();
    });

    it('returns false for non-existent ID', () => {
      expect(deleteRequirement(db, 'nope')).toBe(false);
    });
  });

  describe('importRequirements', () => {
    it('imports multiple requirements', () => {
      const results = importRequirements(db, [
        { reqId: 'REQ-01', title: 'First' },
        { reqId: 'REQ-02', title: 'Second', type: 'non_functional' },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].req_id).toBe('REQ-01');
      expect(results[1].req_id).toBe('REQ-02');
      expect(results[1].type).toBe('non_functional');

      const all = listRequirements(db);
      expect(all).toHaveLength(2);
    });

    it('imports empty array without error', () => {
      const results = importRequirements(db, []);
      expect(results).toHaveLength(0);
    });
  });
});

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  importRequirements,
  linkTestToRequirement,
  unlinkTestFromRequirement,
  getRequirementTests,
  verifyRequirement,
} from './requirements';
import { resolveRequirementId } from './resolve';

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
      last_verified_at    TEXT,
      applies_to          TEXT NOT NULL DEFAULT '[]',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_pm_requirements_req_id ON pm_requirements(req_id);
    CREATE TABLE pm_requirement_test_links (
      requirement_id TEXT NOT NULL,
      test_case_id   TEXT NOT NULL,
      PRIMARY KEY (requirement_id, test_case_id),
      FOREIGN KEY (requirement_id) REFERENCES pm_requirements(id) ON DELETE CASCADE
    );
    CREATE TABLE pm_test_cases (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT,
      title      TEXT,
      body       TEXT,
      sort_order INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
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

    it('duplicate req_id throws UNIQUE constraint error', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'First' });
      expect(() => createRequirement(db, { reqId: 'REQ-01', title: 'Second' })).toThrow();
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

    it('can rename req_id', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Original' });
      const updated = updateRequirement(db, created.id, { reqId: 'REQ-RENAMED-01' });
      expect(updated.req_id).toBe('REQ-RENAMED-01');
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

    it('duplicate req_id in batch rolls back transaction', () => {
      expect(() =>
        importRequirements(db, [
          { reqId: 'REQ-01', title: 'A' },
          { reqId: 'REQ-01', title: 'B' },
        ])
      ).toThrow();
      expect(listRequirements(db)).toHaveLength(0);
    });
  });

  describe('resolveRequirementId', () => {
    it('resolves by exact req_id', () => {
      const created = createRequirement(db, { reqId: 'REQ-AUTH-01', title: 'Auth' });
      expect(resolveRequirementId(db, 'REQ-AUTH-01')).toBe(created.id);
    });

    it('resolves by req_id prefix', () => {
      const created = createRequirement(db, { reqId: 'REQ-AUTH-01', title: 'Auth' });
      expect(resolveRequirementId(db, 'REQ-AUTH')).toBe(created.id);
    });

    it('throws on ambiguous req_id prefix', () => {
      createRequirement(db, { reqId: 'REQ-AUTH-01', title: 'Auth1' });
      createRequirement(db, { reqId: 'REQ-AUTH-02', title: 'Auth2' });
      expect(() => resolveRequirementId(db, 'REQ-AUTH')).toThrow(/Ambiguous/);
    });

    it('throws on non-existent req_id', () => {
      expect(() => resolveRequirementId(db, 'REQ-NOPE-01')).toThrow(/No requirement found/);
    });

    it('resolves by UUID prefix', () => {
      const created = createRequirement(db, { reqId: 'REQ-UUID-01', title: 'UUID test' });
      expect(resolveRequirementId(db, created.id.slice(0, 8))).toBe(created.id);
    });
  });

  describe('createRequirement with appliesTo', () => {
    it('stores appliesTo as JSON string', () => {
      const result = createRequirement(db, {
        reqId: 'REQ-01',
        title: 'Test',
        appliesTo: ['module-a', 'module-b'],
      });
      expect(result.applies_to).toBe('["module-a","module-b"]');
    });

    it('defaults applies_to to empty JSON array', () => {
      const result = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      expect(result.applies_to).toBe('[]');
    });

    it('last_verified_at is null on creation', () => {
      const result = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      expect(result.last_verified_at).toBeNull();
    });
  });

  describe('updateRequirement with appliesTo and lastVerifiedAt', () => {
    it('updates appliesTo as JSON string', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      const updated = updateRequirement(db, created.id, { appliesTo: ['svc-x'] });
      expect(updated.applies_to).toBe('["svc-x"]');
    });

    it('updates lastVerifiedAt', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      const updated = updateRequirement(db, created.id, { lastVerifiedAt: '2026-01-01 00:00:00' });
      expect(updated.last_verified_at).toBe('2026-01-01 00:00:00');
    });
  });

  describe('listRequirements stale filter', () => {
    it('returns verified requirements older than 30 days when stale=true', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'Fresh', status: 'verified' });
      const stale = createRequirement(db, { reqId: 'REQ-02', title: 'Stale', status: 'verified' });
      // manually set last_verified_at to 60 days ago
      db.prepare(
        `UPDATE pm_requirements SET last_verified_at = datetime('now', '-60 days') WHERE id = ?`
      ).run(stale.id);
      const results = listRequirements(db, { stale: true });
      expect(results).toHaveLength(1);
      expect(results[0].req_id).toBe('REQ-02');
    });

    it('returns nothing for stale=true when no stale verified requirements exist', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'Draft' });
      const results = listRequirements(db, { stale: true });
      expect(results).toHaveLength(0);
    });

    it('does not apply stale filter when stale=false', () => {
      createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      const results = listRequirements(db, { stale: false });
      expect(results).toHaveLength(1);
    });
  });

  describe('linkTestToRequirement', () => {
    it('links a test case to a requirement', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      db.prepare(`INSERT INTO pm_test_cases (id, title) VALUES ('tc-1', 'My Test')`).run();
      const result = linkTestToRequirement(db, req.id, 'tc-1');
      expect(result).toEqual({ linked: true });
    });

    it('is idempotent (INSERT OR IGNORE)', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      db.prepare(`INSERT INTO pm_test_cases (id, title) VALUES ('tc-1', 'My Test')`).run();
      linkTestToRequirement(db, req.id, 'tc-1');
      expect(() => linkTestToRequirement(db, req.id, 'tc-1')).not.toThrow();
    });
  });

  describe('unlinkTestFromRequirement', () => {
    it('unlinks an existing link and returns { unlinked: true }', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      db.prepare(`INSERT INTO pm_test_cases (id, title) VALUES ('tc-1', 'My Test')`).run();
      linkTestToRequirement(db, req.id, 'tc-1');
      const result = unlinkTestFromRequirement(db, req.id, 'tc-1');
      expect(result).toEqual({ unlinked: true });
    });

    it('returns { unlinked: false } when link does not exist', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      const result = unlinkTestFromRequirement(db, req.id, 'tc-nonexistent');
      expect(result).toEqual({ unlinked: false });
    });
  });

  describe('getRequirementTests', () => {
    it('returns test cases linked to requirement', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      db.prepare(
        `INSERT INTO pm_test_cases (id, title, body) VALUES ('tc-1', 'TC Title', 'TC Body')`
      ).run();
      linkTestToRequirement(db, req.id, 'tc-1');
      const tests = getRequirementTests(db, req.id);
      expect(tests).toHaveLength(1);
      expect(tests[0].id).toBe('tc-1');
      expect(tests[0].title).toBe('TC Title');
    });

    it('returns empty array when no tests linked', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      expect(getRequirementTests(db, req.id)).toEqual([]);
    });
  });

  describe('verifyRequirement', () => {
    it('sets status to verified and sets last_verified_at', () => {
      const created = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      const result = verifyRequirement(db, created.id);
      expect(result.status).toBe('verified');
      expect(result.last_verified_at).not.toBeNull();
    });

    it('throws for non-existent requirement', () => {
      expect(() => verifyRequirement(db, 'nope')).toThrow();
    });
  });

  describe('cascade delete on requirement', () => {
    it('removes linked tests when requirement is deleted', () => {
      const req = createRequirement(db, { reqId: 'REQ-01', title: 'Test' });
      db.prepare(`INSERT INTO pm_test_cases (id, title) VALUES ('tc-1', 'My Test')`).run();
      linkTestToRequirement(db, req.id, 'tc-1');
      deleteRequirement(db, req.id);
      const links = db
        .prepare(`SELECT * FROM pm_requirement_test_links WHERE requirement_id = ?`)
        .all(req.id);
      expect(links).toHaveLength(0);
    });
  });
});

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import { listBlueprints, getBlueprint, createBlueprint } from './blueprints';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
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
  return db;
}

describe('blueprint MCP tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  describe('listBlueprints', () => {
    it('returns empty array when no blueprints exist', () => {
      expect(listBlueprints(db)).toEqual([]);
    });

    it('returns all blueprints ordered by category then name', () => {
      db.prepare(
        'INSERT INTO blueprints (id, name, tech_stack, goal, complexity, category, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('bp2', 'Zeta', '', '', 'EASY', 'optimizations', '');
      db.prepare(
        'INSERT INTO blueprints (id, name, tech_stack, goal, complexity, category, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('bp1', 'Alpha', 'React', 'Build UI', 'HARD', 'architectures', '# Doc');

      const result = listBlueprints(db);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alpha');
      expect(result[1].name).toBe('Zeta');
    });

    it('filters by category', () => {
      db.prepare('INSERT INTO blueprints (id, name, category) VALUES (?, ?, ?)').run(
        'bp1',
        'Arch BP',
        'architectures'
      );
      db.prepare('INSERT INTO blueprints (id, name, category) VALUES (?, ?, ?)').run(
        'bp2',
        'Opt BP',
        'optimizations'
      );

      const result = listBlueprints(db, 'architectures');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Arch BP');
    });
  });

  describe('getBlueprint', () => {
    it('returns null for non-existent ID', () => {
      expect(getBlueprint(db, 'nope')).toBeNull();
    });

    it('returns the blueprint by ID', () => {
      db.prepare(
        'INSERT INTO blueprints (id, name, tech_stack, goal, complexity, category, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('bp1', 'My BP', 'Rust', 'Speed', 'HARD', 'optimizations', '# Detail');

      const result = getBlueprint(db, 'bp1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('My BP');
      expect(result!.tech_stack).toBe('Rust');
      expect(result!.description).toBe('# Detail');
    });
  });

  describe('createBlueprint', () => {
    it('creates a blueprint with defaults', () => {
      const result = createBlueprint(db, { name: 'New BP' });
      expect(result.name).toBe('New BP');
      expect(result.complexity).toBe('MEDIUM');
      expect(result.category).toBe('architectures');
      expect(result.tech_stack).toBe('');
      expect(result.id).toBeTruthy();
    });

    it('creates a blueprint with all fields', () => {
      const result = createBlueprint(db, {
        name: 'Full BP',
        techStack: 'React, Node',
        goal: 'Ship fast',
        complexity: 'EASY',
        category: 'ui-and-marketing',
        description: '# Spec\nDetails here',
      });
      expect(result.name).toBe('Full BP');
      expect(result.tech_stack).toBe('React, Node');
      expect(result.goal).toBe('Ship fast');
      expect(result.complexity).toBe('EASY');
      expect(result.category).toBe('ui-and-marketing');
      expect(result.description).toBe('# Spec\nDetails here');
    });

    it('persists blueprint to database', () => {
      const created = createBlueprint(db, { name: 'Persist Test' });
      const fetched = getBlueprint(db, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Persist Test');
    });
  });
});

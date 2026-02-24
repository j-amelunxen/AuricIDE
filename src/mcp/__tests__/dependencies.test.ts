import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDependency, createTestCase, listDependencies } from '../tools/dependencies';

function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE pm_epics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE pm_tickets (
      id TEXT PRIMARY KEY,
      epic_id TEXT NOT NULL REFERENCES pm_epics(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      sort_order INTEGER NOT NULL DEFAULT 0,
      context TEXT NOT NULL DEFAULT '[]',
      status_updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
      working_directory TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      model_power TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE pm_test_cases (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE pm_dependencies (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      UNIQUE(source_id, target_id)
    );
  `);
  return db;
}

function seedEpicAndTicket(db: Database.Database) {
  db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
    'epic-1',
    'Test Epic',
    0
  );
  db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
    'ticket-1',
    'epic-1',
    'Test Ticket',
    0
  );
  db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
    'ticket-2',
    'epic-1',
    'Another Ticket',
    1
  );
}

describe('createDependency', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDatabase();
    seedEpicAndTicket(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a dependency row with a UUID', () => {
    const result = createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(result.source_id).toBe('ticket-1');
    expect(result.target_id).toBe('ticket-2');
  });

  it('defaults source_type and target_type to ticket', () => {
    const result = createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    expect(result.source_type).toBe('ticket');
    expect(result.target_type).toBe('ticket');
  });

  it('uses provided source_type and target_type', () => {
    const result = createDependency(db, {
      sourceId: 'ticket-1',
      targetId: 'epic-1',
      sourceType: 'ticket',
      targetType: 'epic',
    });

    expect(result.source_type).toBe('ticket');
    expect(result.target_type).toBe('epic');
  });

  it('is idempotent — INSERT OR IGNORE on duplicate source_id+target_id', () => {
    const first = createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });
    const second = createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    expect(second.id).toBe(first.id);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM pm_dependencies').get() as {
      cnt: number;
    };
    expect(count.cnt).toBe(1);
  });

  it('persists the dependency in the database', () => {
    const created = createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    const row = db.prepare('SELECT * FROM pm_dependencies WHERE id = ?').get(created.id) as {
      id: string;
      source_id: string;
      target_id: string;
    };

    expect(row).toBeDefined();
    expect(row.source_id).toBe('ticket-1');
    expect(row.target_id).toBe('ticket-2');
  });
});

describe('listDependencies', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDatabase();
    seedEpicAndTicket(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when no dependencies exist', () => {
    const result = listDependencies(db);
    expect(result).toEqual([]);
  });

  it('returns all dependencies when no ticketId filter is provided', () => {
    createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    const result = listDependencies(db);
    expect(result).toHaveLength(1);
    expect(result[0].source_id).toBe('ticket-1');
    expect(result[0].target_id).toBe('ticket-2');
  });

  it('returns enriched data with ticket names and statuses', () => {
    createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    const result = listDependencies(db);
    expect(result[0].source_name).toBe('Test Ticket');
    expect(result[0].target_name).toBe('Another Ticket');
    expect(result[0].source_status).toBe('open');
    expect(result[0].target_status).toBe('open');
  });

  it('filters dependencies where ticket is source (depends on)', () => {
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
      'ticket-3',
      'epic-1',
      'Third Ticket',
      2
    );

    createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });
    createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-3' });
    createDependency(db, { sourceId: 'ticket-2', targetId: 'ticket-3' });

    const result = listDependencies(db, { ticketId: 'ticket-1' });
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.source_id === 'ticket-1' || d.target_id === 'ticket-1')).toBe(
      true
    );
  });

  it('filters dependencies where ticket is target (depended on by)', () => {
    createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    const result = listDependencies(db, { ticketId: 'ticket-2' });
    expect(result).toHaveLength(1);
    expect(result[0].target_id).toBe('ticket-2');
  });

  it('returns empty array for ticket with no dependencies', () => {
    createDependency(db, { sourceId: 'ticket-1', targetId: 'ticket-2' });

    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
      'ticket-3',
      'epic-1',
      'Third Ticket',
      2
    );

    const result = listDependencies(db, { ticketId: 'ticket-3' });
    expect(result).toEqual([]);
  });
});

describe('createTestCase', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDatabase();
    seedEpicAndTicket(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a test case row linked to a ticket', () => {
    const result = createTestCase(db, { ticketId: 'ticket-1', title: 'Login works' });

    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(result.ticket_id).toBe('ticket-1');
    expect(result.title).toBe('Login works');
  });

  it('defaults body to empty string', () => {
    const result = createTestCase(db, { ticketId: 'ticket-1', title: 'Test' });

    expect(result.body).toBe('');
  });

  it('uses provided body', () => {
    const result = createTestCase(db, {
      ticketId: 'ticket-1',
      title: 'Test',
      body: 'Check that login form submits',
    });

    expect(result.body).toBe('Check that login form submits');
  });

  it('auto-increments sort_order per ticket', () => {
    const first = createTestCase(db, { ticketId: 'ticket-1', title: 'First' });
    const second = createTestCase(db, { ticketId: 'ticket-1', title: 'Second' });
    const third = createTestCase(db, { ticketId: 'ticket-1', title: 'Third' });

    expect(first.sort_order).toBe(1);
    expect(second.sort_order).toBe(2);
    expect(third.sort_order).toBe(3);
  });

  it('sort_order is per-ticket (different tickets start at 1)', () => {
    const tc1 = createTestCase(db, { ticketId: 'ticket-1', title: 'TC for T1' });
    const tc2 = createTestCase(db, { ticketId: 'ticket-2', title: 'TC for T2' });

    expect(tc1.sort_order).toBe(1);
    expect(tc2.sort_order).toBe(1);
  });

  it('throws on invalid ticketId (FK violation)', () => {
    expect(() => createTestCase(db, { ticketId: 'non-existent', title: 'Should fail' })).toThrow(
      /FOREIGN KEY/
    );
  });

  it('persists the test case in the database', () => {
    const created = createTestCase(db, { ticketId: 'ticket-1', title: 'Persisted TC' });

    const row = db.prepare('SELECT * FROM pm_test_cases WHERE id = ?').get(created.id) as {
      id: string;
      title: string;
    };

    expect(row).toBeDefined();
    expect(row.title).toBe('Persisted TC');
  });
});

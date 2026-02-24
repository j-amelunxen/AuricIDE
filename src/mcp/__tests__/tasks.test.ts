import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusHistoryEntry } from '../tools/history';
import { completeTask, fetchNextTask, fetchNextUnblockedTask } from '../tools/tasks';

const SCHEMA = `
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
    needs_human_supervision INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE pm_status_history (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL DEFAULT 'mcp'
  );
`;

interface SeedTicketOptions {
  id: string;
  epicId: string;
  name: string;
  description?: string;
  status?: string;
  sortOrder?: number;
  priority?: string;
  needsHumanSupervision?: boolean;
}

function seedEpic(db: Database.Database, id: string, name: string): void {
  db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(id, name);
}

function seedTicket(db: Database.Database, options: SeedTicketOptions): void {
  const {
    id,
    epicId,
    name,
    description = '',
    status = 'open',
    sortOrder = 0,
    priority = 'normal',
    needsHumanSupervision = false,
  } = options;
  db.prepare(
    `INSERT INTO pm_tickets (id, epic_id, name, description, status, sort_order, priority, needs_human_supervision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, epicId, name, description, status, sortOrder, priority, needsHumanSupervision ? 1 : 0);
}

describe('task tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    seedEpic(db, 'epic-1', 'Test Epic');
  });

  afterEach(() => {
    db.close();
  });

  describe('fetchNextTask', () => {
    it('returns null when no open tickets exist', () => {
      const result = fetchNextTask(db);
      expect(result).toBeNull();
    });

    it('returns the highest priority open ticket', () => {
      seedTicket(db, {
        id: 'low-1',
        epicId: 'epic-1',
        name: 'Low task',
        priority: 'low',
      });
      seedTicket(db, {
        id: 'critical-1',
        epicId: 'epic-1',
        name: 'Critical task',
        priority: 'critical',
      });
      seedTicket(db, {
        id: 'high-1',
        epicId: 'epic-1',
        name: 'High task',
        priority: 'high',
      });

      const result = fetchNextTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('critical-1');
      expect(result!.name).toBe('Critical task');
    });

    it('sets the returned ticket status to in_progress', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'A task',
        priority: 'normal',
      });

      const result = fetchNextTask(db);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('in_progress');

      // Verify it was persisted in the database
      const row = db.prepare('SELECT status FROM pm_tickets WHERE id = ?').get('ticket-1') as {
        status: string;
      };
      expect(row.status).toBe('in_progress');
    });

    it('updates status_updated_at when fetching', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'A task',
      });

      const before = db
        .prepare('SELECT status_updated_at FROM pm_tickets WHERE id = ?')
        .get('ticket-1') as { status_updated_at: string };

      const result = fetchNextTask(db);
      expect(result).not.toBeNull();
      expect(result!.status_updated_at).not.toBe(before.status_updated_at);
    });

    it('skips non-open tickets', () => {
      seedTicket(db, {
        id: 'done-1',
        epicId: 'epic-1',
        name: 'Done task',
        status: 'done',
        priority: 'critical',
      });
      seedTicket(db, {
        id: 'in-progress-1',
        epicId: 'epic-1',
        name: 'In progress task',
        status: 'in_progress',
        priority: 'critical',
      });
      seedTicket(db, {
        id: 'open-1',
        epicId: 'epic-1',
        name: 'Open task',
        status: 'open',
        priority: 'low',
      });

      const result = fetchNextTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('open-1');
    });

    it('uses sort_order as tiebreaker within same priority', () => {
      seedTicket(db, {
        id: 'ticket-b',
        epicId: 'epic-1',
        name: 'Second by sort',
        priority: 'high',
        sortOrder: 10,
      });
      seedTicket(db, {
        id: 'ticket-a',
        epicId: 'epic-1',
        name: 'First by sort',
        priority: 'high',
        sortOrder: 1,
      });

      const result = fetchNextTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ticket-a');
    });

    it('returns null after all open tickets have been fetched', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'Only task',
      });

      fetchNextTask(db);
      const result = fetchNextTask(db);
      expect(result).toBeNull();
    });

    it('skips tickets with needsHumanSupervision', () => {
      seedTicket(db, {
        id: 'supervised',
        epicId: 'epic-1',
        name: 'Supervised task',
        priority: 'critical',
        needsHumanSupervision: true,
      });
      seedTicket(db, {
        id: 'normal',
        epicId: 'epic-1',
        name: 'Normal task',
        priority: 'low',
      });

      const result = fetchNextTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('normal');
    });

    it('returns null when only supervised tickets are open', () => {
      seedTicket(db, {
        id: 'supervised-1',
        epicId: 'epic-1',
        name: 'Supervised only',
        needsHumanSupervision: true,
      });

      const result = fetchNextTask(db);
      expect(result).toBeNull();
    });

    it('logs history entry (open -> in_progress) when fetching', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'History task',
      });

      fetchNextTask(db);

      const history = db
        .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ?')
        .all('ticket-1') as StatusHistoryEntry[];

      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe('open');
      expect(history[0].to_status).toBe('in_progress');
      expect(history[0].source).toBe('mcp');
    });
  });

  describe('fetchNextUnblockedTask', () => {
    it('returns null when no open tickets exist', () => {
      const result = fetchNextUnblockedTask(db);
      expect(result).toBeNull();
    });

    it('returns highest priority unblocked ticket', () => {
      seedTicket(db, { id: 'ticket-a', epicId: 'epic-1', name: 'Low prio', priority: 'low' });
      seedTicket(db, {
        id: 'ticket-b',
        epicId: 'epic-1',
        name: 'High prio',
        priority: 'high',
      });

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ticket-b');
    });

    it('skips tickets blocked by open dependencies', () => {
      seedTicket(db, {
        id: 'blocker',
        epicId: 'epic-1',
        name: 'Blocker',
        priority: 'low',
      });
      seedTicket(db, {
        id: 'blocked',
        epicId: 'epic-1',
        name: 'Blocked ticket',
        priority: 'critical',
      });

      // blocked depends on blocker (blocker is still open)
      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-1', 'blocked', 'blocker');

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('blocker');
    });

    it('returns blocked ticket once its dependency is done', () => {
      seedTicket(db, {
        id: 'blocker',
        epicId: 'epic-1',
        name: 'Blocker',
        status: 'done',
        priority: 'low',
      });
      seedTicket(db, {
        id: 'was-blocked',
        epicId: 'epic-1',
        name: 'Was blocked',
        priority: 'high',
      });

      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-1', 'was-blocked', 'blocker');

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('was-blocked');
    });

    it('returns blocked ticket once its dependency is archived', () => {
      seedTicket(db, {
        id: 'blocker',
        epicId: 'epic-1',
        name: 'Blocker',
        status: 'archived',
        priority: 'low',
      });
      seedTicket(db, {
        id: 'was-blocked',
        epicId: 'epic-1',
        name: 'Was blocked',
        priority: 'high',
      });

      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-1', 'was-blocked', 'blocker');

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('was-blocked');
    });

    it('skips ticket blocked by multiple dependencies where one is still open', () => {
      seedTicket(db, {
        id: 'dep-done',
        epicId: 'epic-1',
        name: 'Done dep',
        status: 'done',
      });
      seedTicket(db, {
        id: 'dep-open',
        epicId: 'epic-1',
        name: 'Open dep',
        status: 'open',
        priority: 'low',
      });
      seedTicket(db, {
        id: 'blocked',
        epicId: 'epic-1',
        name: 'Blocked by two',
        priority: 'critical',
      });

      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-1', 'blocked', 'dep-done');
      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-2', 'blocked', 'dep-open');

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('dep-open');
    });

    it('sets the returned ticket status to in_progress', () => {
      seedTicket(db, { id: 'ticket-1', epicId: 'epic-1', name: 'A task' });

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('in_progress');
    });

    it('returns null when all open tickets are blocked', () => {
      seedTicket(db, { id: 'a', epicId: 'epic-1', name: 'A', priority: 'critical' });
      seedTicket(db, { id: 'b', epicId: 'epic-1', name: 'B', priority: 'critical' });

      // a depends on b, b depends on a (circular — both blocked)
      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-1', 'a', 'b');
      db.prepare(
        `INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
         VALUES (?, 'ticket', ?, 'ticket', ?)`
      ).run('dep-2', 'b', 'a');

      const result = fetchNextUnblockedTask(db);
      expect(result).toBeNull();
    });

    it('skips tickets with needsHumanSupervision', () => {
      seedTicket(db, {
        id: 'supervised',
        epicId: 'epic-1',
        name: 'Supervised task',
        priority: 'critical',
        needsHumanSupervision: true,
      });
      seedTicket(db, {
        id: 'normal',
        epicId: 'epic-1',
        name: 'Normal task',
        priority: 'low',
      });

      const result = fetchNextUnblockedTask(db);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('normal');
    });

    it('logs history entry (open -> in_progress) when fetching unblocked', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'Unblocked task',
      });

      fetchNextUnblockedTask(db);

      const history = db
        .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ?')
        .all('ticket-1') as StatusHistoryEntry[];

      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe('open');
      expect(history[0].to_status).toBe('in_progress');
      expect(history[0].source).toBe('mcp');
    });
  });

  describe('completeTask', () => {
    it('marks a ticket as done', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'A task',
        status: 'in_progress',
      });

      const result = completeTask(db, { id: 'ticket-1' });
      expect(result.status).toBe('done');

      const row = db.prepare('SELECT status FROM pm_tickets WHERE id = ?').get('ticket-1') as {
        status: string;
      };
      expect(row.status).toBe('done');
    });

    it('updates status_updated_at when completing', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'A task',
        status: 'in_progress',
      });

      const before = db
        .prepare('SELECT status_updated_at FROM pm_tickets WHERE id = ?')
        .get('ticket-1') as { status_updated_at: string };

      const result = completeTask(db, { id: 'ticket-1' });
      expect(result.status_updated_at).not.toBe(before.status_updated_at);
    });

    it('appends summary to description when provided', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'A task',
        description: 'Original description',
        status: 'in_progress',
      });

      const result = completeTask(db, {
        id: 'ticket-1',
        summary: 'Task was completed successfully.',
      });
      expect(result.description).toBe(
        'Original description\n\n---\nCompletion Summary: Task was completed successfully.'
      );
    });

    it('does not modify description when summary is not provided', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'A task',
        description: 'Original description',
        status: 'in_progress',
      });

      const result = completeTask(db, { id: 'ticket-1' });
      expect(result.description).toBe('Original description');
    });

    it('throws for non-existent ticket', () => {
      expect(() => completeTask(db, { id: 'nonexistent' })).toThrow(
        'Ticket not found: nonexistent'
      );
    });

    it('logs history entry (existing status -> done) when completing', () => {
      seedTicket(db, {
        id: 'ticket-1',
        epicId: 'epic-1',
        name: 'Complete history task',
        status: 'in_progress',
      });

      completeTask(db, { id: 'ticket-1' });

      const history = db
        .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ?')
        .all('ticket-1') as StatusHistoryEntry[];

      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe('in_progress');
      expect(history[0].to_status).toBe('done');
      expect(history[0].source).toBe('mcp');
    });
  });
});

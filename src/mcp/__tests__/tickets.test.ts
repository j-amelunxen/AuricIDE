import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusHistoryEntry } from '../tools/history';
import { createTicket, listTickets, updateTicket } from '../tools/tickets';

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

  CREATE TABLE pm_status_history (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL DEFAULT 'mcp'
  );
`;

function seedEpic(db: Database.Database, id: string, name: string): void {
  db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(id, name);
}

describe('ticket tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    seedEpic(db, 'epic-1', 'Epic One');
    seedEpic(db, 'epic-2', 'Epic Two');
  });

  afterEach(() => {
    db.close();
  });

  describe('listTickets', () => {
    it('returns an empty array when no tickets exist', () => {
      const result = listTickets(db);
      expect(result).toEqual([]);
    });

    it('returns all tickets ordered by sort_order when no filters given', () => {
      createTicket(db, { epicId: 'epic-1', name: 'Ticket B' });
      createTicket(db, { epicId: 'epic-1', name: 'Ticket A' });

      const result = listTickets(db);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Ticket B');
      expect(result[1].name).toBe('Ticket A');
      expect(result[0].sort_order).toBeLessThan(result[1].sort_order);
    });

    it('filters tickets by status', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Open Ticket' });
      createTicket(db, { epicId: 'epic-1', name: 'Another Ticket' });
      updateTicket(db, { id: ticket.id, status: 'done' });

      const openTickets = listTickets(db, { status: 'open' });
      const doneTickets = listTickets(db, { status: 'done' });

      expect(openTickets).toHaveLength(1);
      expect(openTickets[0].name).toBe('Another Ticket');
      expect(doneTickets).toHaveLength(1);
      expect(doneTickets[0].name).toBe('Open Ticket');
    });

    it('filters tickets by epicId', () => {
      createTicket(db, { epicId: 'epic-1', name: 'Epic 1 Ticket' });
      createTicket(db, { epicId: 'epic-2', name: 'Epic 2 Ticket' });

      const epic1Tickets = listTickets(db, { epicId: 'epic-1' });
      const epic2Tickets = listTickets(db, { epicId: 'epic-2' });

      expect(epic1Tickets).toHaveLength(1);
      expect(epic1Tickets[0].name).toBe('Epic 1 Ticket');
      expect(epic2Tickets).toHaveLength(1);
      expect(epic2Tickets[0].name).toBe('Epic 2 Ticket');
    });

    it('combines status and epicId filters', () => {
      createTicket(db, { epicId: 'epic-1', name: 'Open in E1' });
      const doneInE1 = createTicket(db, { epicId: 'epic-1', name: 'Done in E1' });
      createTicket(db, { epicId: 'epic-2', name: 'Open in E2' });
      updateTicket(db, { id: doneInE1.id, status: 'done' });

      const result = listTickets(db, { status: 'open', epicId: 'epic-1' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Open in E1');
    });
  });

  describe('createTicket', () => {
    it('creates a ticket with default values', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'My Ticket' });

      expect(ticket.id).toBeDefined();
      expect(ticket.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(ticket.epic_id).toBe('epic-1');
      expect(ticket.name).toBe('My Ticket');
      expect(ticket.description).toBe('');
      expect(ticket.status).toBe('open');
      expect(ticket.priority).toBe('normal');
      expect(ticket.sort_order).toBe(1);
    });

    it('creates a ticket with all optional parameters', () => {
      const ticket = createTicket(db, {
        epicId: 'epic-1',
        name: 'Full Ticket',
        description: 'A detailed description',
        priority: 'high',
      });

      expect(ticket.name).toBe('Full Ticket');
      expect(ticket.description).toBe('A detailed description');
      expect(ticket.priority).toBe('high');
      expect(ticket.status).toBe('open');
    });

    it('sets sort_order to MAX(sort_order)+1 within the same epic', () => {
      const first = createTicket(db, { epicId: 'epic-1', name: 'First' });
      const second = createTicket(db, { epicId: 'epic-1', name: 'Second' });
      const third = createTicket(db, { epicId: 'epic-1', name: 'Third' });

      expect(first.sort_order).toBe(1);
      expect(second.sort_order).toBe(2);
      expect(third.sort_order).toBe(3);
    });

    it('calculates sort_order independently per epic', () => {
      const epic1Ticket = createTicket(db, { epicId: 'epic-1', name: 'E1 Ticket' });
      const epic2Ticket = createTicket(db, { epicId: 'epic-2', name: 'E2 Ticket' });

      expect(epic1Ticket.sort_order).toBe(1);
      expect(epic2Ticket.sort_order).toBe(1);
    });

    it('persists the ticket in the database', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Persisted' });

      const row = db.prepare('SELECT * FROM pm_tickets WHERE id = ?').get(ticket.id) as Record<
        string,
        unknown
      >;

      expect(row).toBeDefined();
      expect(row.name).toBe('Persisted');
      expect(row.epic_id).toBe('epic-1');
    });

    it('defaults needsHumanSupervision to 0', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Default supervision' });

      expect(ticket.needs_human_supervision).toBe(0);
    });

    it('logs a status history entry (null -> open) on creation', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'History Test' });

      const history = db
        .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ?')
        .all(ticket.id) as StatusHistoryEntry[];

      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBeNull();
      expect(history[0].to_status).toBe('open');
      expect(history[0].source).toBe('mcp');
    });
  });

  describe('updateTicket', () => {
    it('updates the status and sets status_updated_at', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Status Test' });
      const originalStatusUpdatedAt = ticket.status_updated_at;

      const updated = updateTicket(db, { id: ticket.id, status: 'in_progress' });

      expect(updated.status).toBe('in_progress');
      expect(updated.status_updated_at).not.toBe(originalStatusUpdatedAt);
    });

    it('throws an error for a non-existent ticket', () => {
      expect(() => {
        updateTicket(db, { id: 'non-existent-id', status: 'done' });
      }).toThrow('Ticket not found: non-existent-id');
    });

    it('updates only the name when only name is provided', () => {
      const ticket = createTicket(db, {
        epicId: 'epic-1',
        name: 'Original Name',
        description: 'Original Desc',
        priority: 'normal',
      });

      const updated = updateTicket(db, { id: ticket.id, name: 'New Name' });

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Original Desc');
      expect(updated.priority).toBe('normal');
      expect(updated.status).toBe('open');
    });

    it('updates description without changing other fields', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Desc Test' });

      const updated = updateTicket(db, {
        id: ticket.id,
        description: 'Updated description',
      });

      expect(updated.description).toBe('Updated description');
      expect(updated.name).toBe('Desc Test');
    });

    it('updates priority without changing other fields', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Priority Test' });

      const updated = updateTicket(db, { id: ticket.id, priority: 'urgent' });

      expect(updated.priority).toBe('urgent');
      expect(updated.name).toBe('Priority Test');
      expect(updated.status).toBe('open');
    });

    it('does not update status_updated_at when status is not changed', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'No Status Change' });
      const originalStatusUpdatedAt = ticket.status_updated_at;

      const updated = updateTicket(db, { id: ticket.id, name: 'Renamed' });

      expect(updated.status_updated_at).toBe(originalStatusUpdatedAt);
    });

    it('updates multiple fields at once', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Multi Update' });

      const updated = updateTicket(db, {
        id: ticket.id,
        name: 'New Name',
        description: 'New Desc',
        status: 'done',
        priority: 'low',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('New Desc');
      expect(updated.status).toBe('done');
      expect(updated.priority).toBe('low');
    });

    it('sets needsHumanSupervision via updateTicket', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Supervision Test' });
      expect(ticket.needs_human_supervision).toBe(0);

      const updated = updateTicket(db, { id: ticket.id, needsHumanSupervision: true });
      expect(updated.needs_human_supervision).toBe(1);

      const reverted = updateTicket(db, { id: ticket.id, needsHumanSupervision: false });
      expect(reverted.needs_human_supervision).toBe(0);
    });

    it('logs a status history entry when status changes', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Status History Test' });

      updateTicket(db, { id: ticket.id, status: 'in_progress' });

      const history = db
        .prepare("SELECT * FROM pm_status_history WHERE ticket_id = ? AND from_status = 'open'")
        .all(ticket.id) as StatusHistoryEntry[];

      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe('open');
      expect(history[0].to_status).toBe('in_progress');
      expect(history[0].source).toBe('mcp');
    });

    it('does NOT log history when status is not changed', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'No Status Change' });

      // Only the creation entry (null -> open) should exist
      updateTicket(db, { id: ticket.id, name: 'Renamed' });

      const history = db
        .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ?')
        .all(ticket.id) as StatusHistoryEntry[];

      // Only the initial creation entry
      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBeNull();
      expect(history[0].to_status).toBe('open');
    });

    it('does NOT log history when updating to the same status', () => {
      const ticket = createTicket(db, { epicId: 'epic-1', name: 'Same Status' });

      updateTicket(db, { id: ticket.id, status: 'open' });

      const history = db
        .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ?')
        .all(ticket.id) as StatusHistoryEntry[];

      // Only the initial creation entry, no duplicate for same status
      expect(history).toHaveLength(1);
    });
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTicket, listTickets, updateTicket } from './tickets';
import { createGoal } from './goals';
import { createTestDb } from '../db';

function insertEpic(db: Database.Database, id = 'e1'): void {
  db.prepare('INSERT OR IGNORE INTO pm_epics (id, name) VALUES (?, ?)').run(id, 'Epic');
}

describe('ticket MCP tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    insertEpic(db);
  });

  describe('createTicket', () => {
    it('creates an open ticket with defaults', () => {
      const ticket = createTicket(db, { epicId: 'e1', name: 'Do the thing' });
      expect(ticket.name).toBe('Do the thing');
      expect(ticket.status).toBe('open');
      expect(ticket.priority).toBe('normal');
      expect(ticket.goal_id).toBeNull();
    });

    it('links the ticket to a goal atomically when goalId is given', () => {
      const goal = createGoal(db, { name: 'Ship onboarding' }, 'mcp');
      const ticket = createTicket(db, {
        epicId: 'e1',
        name: 'Build empty state',
        goalId: goal.id,
      });
      expect(ticket.goal_id).toBe(goal.id);

      const row = db.prepare('SELECT goal_id FROM pm_tickets WHERE id = ?').get(ticket.id) as {
        goal_id: string | null;
      };
      expect(row.goal_id).toBe(goal.id);
    });

    it('persists human supervision when requested at creation', () => {
      const ticket = createTicket(db, {
        epicId: 'e1',
        name: 'Approve launch',
        needsHumanSupervision: true,
      });
      expect(ticket.needs_human_supervision).toBe(1);
    });

    it('increments sort_order per epic', () => {
      const first = createTicket(db, { epicId: 'e1', name: 'First' });
      const second = createTicket(db, { epicId: 'e1', name: 'Second' });
      expect(second.sort_order).toBe(first.sort_order + 1);
    });
  });

  describe('listTickets / updateTicket', () => {
    it('filters by status', () => {
      const ticket = createTicket(db, { epicId: 'e1', name: 'A' });
      createTicket(db, { epicId: 'e1', name: 'B' });
      updateTicket(db, { id: ticket.id, status: 'done' });
      const open = listTickets(db, { status: 'open' });
      expect(open).toHaveLength(1);
      expect(open[0].name).toBe('B');
    });
  });
});

describe('ticket state validation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    insertEpic(db);
  });

  it('rejects a status outside the vocabulary', () => {
    const ticket = createTicket(db, { epicId: 'e1', name: 'Do the thing' });
    expect(() => updateTicket(db, { id: ticket.id, status: 'Done' })).toThrow(/status/i);
  });

  it('names the field, what was expected and what arrived', () => {
    const ticket = createTicket(db, { epicId: 'e1', name: 'Do the thing' });
    let message = '';
    try {
      updateTicket(db, { id: ticket.id, status: 'complete' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('status');
    expect(message).toContain('complete');
    expect(message).toContain('open');
  });

  it('leaves the ticket untouched when the status is rejected', () => {
    const ticket = createTicket(db, { epicId: 'e1', name: 'Do the thing' });
    expect(() => updateTicket(db, { id: ticket.id, status: 'Done', name: 'Renamed' })).toThrow();
    const after = listTickets(db).find((t) => t.id === ticket.id)!;
    expect(after.status).toBe('open');
    expect(after.name).toBe('Do the thing');
  });

  it('accepts every status the app can reason about', () => {
    const ticket = createTicket(db, { epicId: 'e1', name: 'Do the thing' });
    for (const status of [
      'open',
      'in_progress',
      'to_test',
      'in_review',
      'done',
      'archived',
      'discarded',
    ]) {
      expect(() => updateTicket(db, { id: ticket.id, status })).not.toThrow();
    }
  });

  it('rejects a priority outside the ladder', () => {
    const ticket = createTicket(db, { epicId: 'e1', name: 'Do the thing' });
    expect(() => updateTicket(db, { id: ticket.id, priority: 'urgent' })).toThrow(/priority/i);
  });

  it('rejects an invalid priority at creation', () => {
    expect(() => createTicket(db, { epicId: 'e1', name: 'X', priority: 'URGENT' })).toThrow(
      /priority/i
    );
  });

  it('rejects an unknown status filter instead of silently listing nothing', () => {
    expect(() => listTickets(db, { status: 'Done' })).toThrow(/status/i);
  });
});

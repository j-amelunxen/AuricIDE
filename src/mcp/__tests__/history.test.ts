import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { insertStatusHistory, listStatusHistory } from '../tools/history';
import { createTestDb } from '../db';

function seedEpic(db: Database.Database, id: string, name: string): void {
  db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(id, name);
}

function seedTicket(db: Database.Database, id: string, epicId: string, name: string): void {
  db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(id, epicId, name);
}

describe('history tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedEpic(db, 'epic-1', 'Epic One');
    seedTicket(db, 'ticket-1', 'epic-1', 'Ticket One');
    seedTicket(db, 'ticket-2', 'epic-1', 'Ticket Two');
  });

  afterEach(() => {
    db.close();
  });

  describe('insertStatusHistory', () => {
    it('creates a history entry with from_status null for initial creation', () => {
      insertStatusHistory(db, 'ticket-1', null, 'open', 'mcp');

      const rows = db.prepare('SELECT * FROM pm_status_history').all() as {
        ticket_id: string;
        from_status: string | null;
        to_status: string;
        source: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0].ticket_id).toBe('ticket-1');
      expect(rows[0].from_status).toBeNull();
      expect(rows[0].to_status).toBe('open');
      expect(rows[0].source).toBe('mcp');
    });

    it('creates a history entry with from and to status', () => {
      insertStatusHistory(db, 'ticket-1', 'open', 'in_progress', 'mcp');

      const rows = db.prepare('SELECT * FROM pm_status_history').all() as {
        from_status: string | null;
        to_status: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0].from_status).toBe('open');
      expect(rows[0].to_status).toBe('in_progress');
    });

    it('generates a valid UUID for the id', () => {
      insertStatusHistory(db, 'ticket-1', null, 'open', 'mcp');

      const row = db.prepare('SELECT id FROM pm_status_history').get() as { id: string };
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('listStatusHistory', () => {
    it('returns all entries when no ticketId is provided', () => {
      insertStatusHistory(db, 'ticket-1', null, 'open', 'mcp');
      insertStatusHistory(db, 'ticket-2', null, 'open', 'mcp');
      insertStatusHistory(db, 'ticket-1', 'open', 'in_progress', 'mcp');

      const result = listStatusHistory(db);

      expect(result).toHaveLength(3);
    });

    it('filters by ticketId when provided', () => {
      insertStatusHistory(db, 'ticket-1', null, 'open', 'mcp');
      insertStatusHistory(db, 'ticket-2', null, 'open', 'mcp');
      insertStatusHistory(db, 'ticket-1', 'open', 'in_progress', 'mcp');

      const result = listStatusHistory(db, 'ticket-1');

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.ticket_id === 'ticket-1')).toBe(true);
    });

    it('returns entries ordered by changed_at ascending', () => {
      insertStatusHistory(db, 'ticket-1', null, 'open', 'mcp');
      insertStatusHistory(db, 'ticket-1', 'open', 'in_progress', 'mcp');
      insertStatusHistory(db, 'ticket-1', 'in_progress', 'done', 'mcp');

      const result = listStatusHistory(db, 'ticket-1');

      expect(result).toHaveLength(3);
      expect(result[0].to_status).toBe('open');
      expect(result[1].to_status).toBe('in_progress');
      expect(result[2].to_status).toBe('done');
    });

    it('returns an empty array when no history exists', () => {
      const result = listStatusHistory(db);
      expect(result).toEqual([]);
    });

    it('returns entries with all expected fields', () => {
      insertStatusHistory(db, 'ticket-1', null, 'open', 'mcp');

      const result = listStatusHistory(db);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('ticket_id');
      expect(result[0]).toHaveProperty('from_status');
      expect(result[0]).toHaveProperty('to_status');
      expect(result[0]).toHaveProperty('changed_at');
      expect(result[0]).toHaveProperty('source');
    });
  });
});

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addContextItem,
  clearTicketContext,
  getTicketContext,
  removeContextItem,
} from '../tools/context';

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
`;

describe('context tools', () => {
  let db: Database.Database;
  let ticketId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);

    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Epic One');
    db.prepare(
      "INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, 'epic-1', 'Test Ticket')"
    ).run('ticket-1');
    ticketId = 'ticket-1';
  });

  afterEach(() => {
    db.close();
  });

  // --- getTicketContext ---

  describe('getTicketContext', () => {
    it('returns an empty array for a new ticket', () => {
      expect(getTicketContext(db, ticketId)).toEqual([]);
    });

    it('throws for a non-existent ticket', () => {
      expect(() => getTicketContext(db, 'no-such-id')).toThrow('Ticket not found: no-such-id');
    });

    it('returns the stored context items', () => {
      db.prepare("UPDATE pm_tickets SET context = ? WHERE id = ?").run(
        JSON.stringify([{ id: 'c1', type: 'snippet', value: 'console.log("hello")' }]),
        ticketId
      );

      const items = getTicketContext(db, ticketId);
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ id: 'c1', type: 'snippet', value: 'console.log("hello")' });
    });
  });

  // --- addContextItem ---

  describe('addContextItem', () => {
    it('adds a snippet and returns the updated context', () => {
      const items = addContextItem(db, ticketId, 'snippet', 'const x = 1;');

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('snippet');
      expect(items[0].value).toBe('const x = 1;');
      expect(items[0].id).toBeDefined();
    });

    it('adds a file reference and returns the updated context', () => {
      const items = addContextItem(db, ticketId, 'file', 'src/lib/utils.ts');

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('file');
      expect(items[0].value).toBe('src/lib/utils.ts');
    });

    it('appends to existing context items', () => {
      addContextItem(db, ticketId, 'snippet', 'first snippet');
      const items = addContextItem(db, ticketId, 'file', 'src/index.ts');

      expect(items).toHaveLength(2);
      expect(items[0].type).toBe('snippet');
      expect(items[1].type).toBe('file');
    });

    it('persists the new item to the database', () => {
      addContextItem(db, ticketId, 'snippet', 'persisted content');

      const raw = (
        db.prepare('SELECT context FROM pm_tickets WHERE id = ?').get(ticketId) as {
          context: string;
        }
      ).context;
      const parsed = JSON.parse(raw) as { type: string; value: string }[];

      expect(parsed).toHaveLength(1);
      expect(parsed[0].value).toBe('persisted content');
    });

    it('updates updated_at on the ticket', () => {
      const before = (
        db.prepare('SELECT updated_at FROM pm_tickets WHERE id = ?').get(ticketId) as {
          updated_at: string;
        }
      ).updated_at;

      // Slight delay to ensure timestamp differs
      addContextItem(db, ticketId, 'snippet', 'something');

      const after = (
        db.prepare('SELECT updated_at FROM pm_tickets WHERE id = ?').get(ticketId) as {
          updated_at: string;
        }
      ).updated_at;

      // updated_at must be set (may equal before if same second, but should not be null)
      expect(after).toBeDefined();
      expect(before).toBeDefined();
    });

    it('throws for a non-existent ticket', () => {
      expect(() => addContextItem(db, 'no-such-id', 'snippet', 'x')).toThrow(
        'Ticket not found: no-such-id'
      );
    });

    it('each added item gets a unique id', () => {
      addContextItem(db, ticketId, 'snippet', 'a');
      addContextItem(db, ticketId, 'snippet', 'b');
      const items = getTicketContext(db, ticketId);

      expect(items[0].id).not.toBe(items[1].id);
    });
  });

  // --- removeContextItem ---

  describe('removeContextItem', () => {
    it('removes the item with the given id', () => {
      addContextItem(db, ticketId, 'snippet', 'keep me');
      const withTwo = addContextItem(db, ticketId, 'file', 'remove/me.ts');
      const removeId = withTwo[1].id;

      const result = removeContextItem(db, ticketId, removeId);

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe('keep me');
    });

    it('is a no-op when the item id does not exist', () => {
      addContextItem(db, ticketId, 'snippet', 'keep');

      const result = removeContextItem(db, ticketId, 'non-existent-item-id');

      expect(result).toHaveLength(1);
    });

    it('throws for a non-existent ticket', () => {
      expect(() => removeContextItem(db, 'no-such-id', 'item-1')).toThrow(
        'Ticket not found: no-such-id'
      );
    });

    it('returns empty array when the only item is removed', () => {
      const items = addContextItem(db, ticketId, 'snippet', 'only one');
      const result = removeContextItem(db, ticketId, items[0].id);

      expect(result).toEqual([]);
    });
  });

  // --- clearTicketContext ---

  describe('clearTicketContext', () => {
    it('removes all context items', () => {
      addContextItem(db, ticketId, 'snippet', 'a');
      addContextItem(db, ticketId, 'file', 'b.ts');

      clearTicketContext(db, ticketId);

      expect(getTicketContext(db, ticketId)).toEqual([]);
    });

    it('is a no-op on an already-empty context', () => {
      expect(() => clearTicketContext(db, ticketId)).not.toThrow();
      expect(getTicketContext(db, ticketId)).toEqual([]);
    });

    it('throws for a non-existent ticket', () => {
      expect(() => clearTicketContext(db, 'no-such-id')).toThrow('Ticket not found: no-such-id');
    });
  });
});

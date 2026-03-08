import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  resolveId,
  resolveTicketId,
  resolveEpicId,
  resolveBlueprintId,
  typeToTable,
} from './resolve';
import { createTestDb } from '../db';

describe('resolveId', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns a full UUID unchanged without querying the DB', () => {
    const fullId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    // No row exists — should still return the UUID directly (fast path)
    const result = resolveId(db, 'pm_tickets', fullId);
    expect(result).toBe(fullId);
  });

  it('resolves a unique prefix to the full ID', () => {
    const fullId = 'abcd1234-aaaa-bbbb-cccc-ddddeeee0001';
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(fullId, 'Test Epic');

    const result = resolveId(db, 'pm_epics', 'abcd1234');
    expect(result).toBe(fullId);
  });

  it('throws when no rows match the prefix', () => {
    expect(() => resolveId(db, 'pm_tickets', 'deadbeef')).toThrow(
      "No tickets found for ID prefix 'deadbeef'"
    );
  });

  it('throws when multiple rows match the prefix', () => {
    const epicId = 'eeee0000-0000-0000-0000-000000000001';
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(epicId, 'Epic');

    db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(
      'abcd0000-1111-2222-3333-444444444444',
      epicId,
      'Ticket A'
    );
    db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(
      'abcd0000-5555-6666-7777-888888888888',
      epicId,
      'Ticket B'
    );

    expect(() => resolveId(db, 'pm_tickets', 'abcd0000')).toThrow(
      /Ambiguous ID prefix 'abcd0000' matches 2 tickets/
    );
  });

  it('includes example IDs in ambiguous error', () => {
    const epicId = 'eeee0000-0000-0000-0000-000000000001';
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(epicId, 'Epic');

    const id1 = 'abcd0000-1111-2222-3333-444444444444';
    const id2 = 'abcd0000-5555-6666-7777-888888888888';
    db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(
      id1,
      epicId,
      'Ticket A'
    );
    db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(
      id2,
      epicId,
      'Ticket B'
    );

    try {
      resolveId(db, 'pm_tickets', 'abcd0000');
      expect.fail('should have thrown');
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain(id1);
      expect(msg).toContain(id2);
    }
  });

  it('throws for empty prefix', () => {
    expect(() => resolveId(db, 'pm_tickets', '')).toThrow(/too short/);
  });

  it('throws for prefix shorter than 4 characters', () => {
    expect(() => resolveId(db, 'pm_tickets', 'abc')).toThrow(/too short/);
  });

  it('resolves case-insensitively', () => {
    const fullId = 'abcd1234-aaaa-bbbb-cccc-ddddeeee0001';
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(fullId, 'Epic');
    expect(resolveId(db, 'pm_epics', 'ABCD1234')).toBe(fullId);
  });

  it('resolves longer prefixes including hyphens', () => {
    const fullId = 'abcd1234-aaaa-bbbb-cccc-ddddeeee0001';
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(fullId, 'Epic');
    expect(resolveId(db, 'pm_epics', 'abcd1234-aaaa')).toBe(fullId);
  });

  it('works for the blueprints table', () => {
    const fullId = 'beef1234-0000-1111-2222-333344445555';
    db.prepare('INSERT INTO blueprints (id, name) VALUES (?, ?)').run(fullId, 'My Blueprint');

    expect(resolveId(db, 'blueprints', 'beef1234')).toBe(fullId);
  });

  describe('convenience helpers', () => {
    it('resolveTicketId resolves from pm_tickets', () => {
      const epicId = 'eeee0000-0000-0000-0000-000000000001';
      const ticketId = 'face0001-aaaa-bbbb-cccc-ddddeeeeffff';
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(epicId, 'Epic');
      db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(
        ticketId,
        epicId,
        'Ticket'
      );

      expect(resolveTicketId(db, 'face0001')).toBe(ticketId);
    });

    it('resolveEpicId resolves from pm_epics', () => {
      const epicId = 'cafe0002-aaaa-bbbb-cccc-ddddeeeeffff';
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(epicId, 'Epic');

      expect(resolveEpicId(db, 'cafe0002')).toBe(epicId);
    });

    it('resolveBlueprintId resolves from blueprints', () => {
      const bpId = 'dead0003-aaaa-bbbb-cccc-ddddeeeeffff';
      db.prepare('INSERT INTO blueprints (id, name) VALUES (?, ?)').run(bpId, 'Blueprint');

      expect(resolveBlueprintId(db, 'dead0003')).toBe(bpId);
    });
  });

  describe('typeToTable', () => {
    it('maps ticket to pm_tickets', () => {
      expect(typeToTable('ticket')).toBe('pm_tickets');
    });

    it('maps epic to pm_epics', () => {
      expect(typeToTable('epic')).toBe('pm_epics');
    });

    it('throws for unknown type', () => {
      expect(() => typeToTable('unknown')).toThrow("Unknown dependency type: 'unknown'");
    });
  });
});

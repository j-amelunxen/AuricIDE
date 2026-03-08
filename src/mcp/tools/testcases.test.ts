import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestCase } from './testcases';
import { createTestDb } from '../db';

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

describe('createTestCase', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
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

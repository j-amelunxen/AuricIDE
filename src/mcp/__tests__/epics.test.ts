import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../db';
import { createEpic, getEpicWithTickets, listEpics } from '../tools/epics';

describe('listEpics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns an empty array when no epics exist', () => {
    const result = listEpics(db);
    expect(result).toEqual([]);
  });

  it('returns epics with ticketCount of 0 when no tickets exist', () => {
    db.prepare(
      `INSERT INTO pm_epics (id, name, description, sort_order)
       VALUES (?, ?, ?, ?)`
    ).run('epic-1', 'First Epic', 'Description 1', 0);

    const result = listEpics(db);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'epic-1',
      name: 'First Epic',
      description: 'Description 1',
      sort_order: 0,
      ticketCount: 0,
    });
  });

  it('returns correct ticketCount for epics with tickets', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-1',
      'Epic One',
      0
    );
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-2',
      'Epic Two',
      1
    );

    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)`).run(
      'ticket-1',
      'epic-1',
      'Ticket A'
    );
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)`).run(
      'ticket-2',
      'epic-1',
      'Ticket B'
    );
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)`).run(
      'ticket-3',
      'epic-2',
      'Ticket C'
    );

    const result = listEpics(db);

    expect(result).toHaveLength(2);

    const epicOne = result.find((e) => e.id === 'epic-1');
    const epicTwo = result.find((e) => e.id === 'epic-2');

    expect(epicOne?.ticketCount).toBe(2);
    expect(epicTwo?.ticketCount).toBe(1);
  });

  it('orders epics by sort_order', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-b',
      'Second',
      1
    );
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-a',
      'First',
      0
    );
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-c',
      'Third',
      2
    );

    const result = listEpics(db);

    expect(result.map((e) => e.id)).toEqual(['epic-a', 'epic-b', 'epic-c']);
  });

  it('includes created_at and updated_at timestamps', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-1',
      'Test Epic',
      0
    );

    const result = listEpics(db);

    expect(result[0].created_at).toBeDefined();
    expect(result[0].updated_at).toBeDefined();
    expect(typeof result[0].created_at).toBe('string');
    expect(typeof result[0].updated_at).toBe('string');
  });
});

describe('createEpic', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates an epic with a generated UUID', () => {
    const result = createEpic(db, { name: 'New Epic' });

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    // UUID v4 format check
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('creates an epic with the provided name', () => {
    const result = createEpic(db, { name: 'My Epic' });

    expect(result.name).toBe('My Epic');
  });

  it('sets description to empty string when not provided', () => {
    const result = createEpic(db, { name: 'No Description Epic' });

    expect(result.description).toBe('');
  });

  it('uses the provided description when given', () => {
    const result = createEpic(db, {
      name: 'Described Epic',
      description: 'A detailed description',
    });

    expect(result.description).toBe('A detailed description');
  });

  it('sets sort_order to 0 when no epics exist', () => {
    const result = createEpic(db, { name: 'First Epic' });

    expect(result.sort_order).toBe(0);
  });

  it('sets sort_order to MAX(sort_order) + 1', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'existing-1',
      'Existing',
      5
    );

    const result = createEpic(db, { name: 'New Epic' });

    expect(result.sort_order).toBe(6);
  });

  it('persists the epic in the database', () => {
    const created = createEpic(db, { name: 'Persisted Epic' });

    const row = db.prepare('SELECT * FROM pm_epics WHERE id = ?').get(created.id) as {
      id: string;
      name: string;
    };

    expect(row).toBeDefined();
    expect(row.name).toBe('Persisted Epic');
  });

  it('includes created_at and updated_at in the returned epic', () => {
    const result = createEpic(db, { name: 'Timestamped Epic' });

    expect(result.created_at).toBeDefined();
    expect(result.updated_at).toBeDefined();
    expect(typeof result.created_at).toBe('string');
    expect(typeof result.updated_at).toBe('string');
  });

  it('creates multiple epics with incrementing sort_order', () => {
    const first = createEpic(db, { name: 'First' });
    const second = createEpic(db, { name: 'Second' });
    const third = createEpic(db, { name: 'Third' });

    expect(first.sort_order).toBe(0);
    expect(second.sort_order).toBe(1);
    expect(third.sort_order).toBe(2);
  });

  it('generates unique IDs for each epic', () => {
    const first = createEpic(db, { name: 'First' });
    const second = createEpic(db, { name: 'Second' });

    expect(first.id).not.toBe(second.id);
  });
});

describe('getEpicWithTickets', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when epic does not exist', () => {
    const result = getEpicWithTickets(db, 'non-existent');
    expect(result).toBeNull();
  });

  it('returns epic with empty tickets array when no tickets exist', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-1',
      'Empty Epic',
      0
    );

    const result = getEpicWithTickets(db, 'epic-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('epic-1');
    expect(result!.name).toBe('Empty Epic');
    expect(result!.tickets).toEqual([]);
  });

  it('returns epic with its tickets ordered by sort_order', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-1',
      'My Epic',
      0
    );
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
      't-2',
      'epic-1',
      'Second Ticket',
      2
    );
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
      't-1',
      'epic-1',
      'First Ticket',
      1
    );

    const result = getEpicWithTickets(db, 'epic-1');

    expect(result!.tickets).toHaveLength(2);
    expect(result!.tickets[0].id).toBe('t-1');
    expect(result!.tickets[1].id).toBe('t-2');
  });

  it('does not include tickets from other epics', () => {
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-1',
      'Epic One',
      0
    );
    db.prepare(`INSERT INTO pm_epics (id, name, sort_order) VALUES (?, ?, ?)`).run(
      'epic-2',
      'Epic Two',
      1
    );
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
      't-1',
      'epic-1',
      'Ticket A',
      0
    );
    db.prepare(`INSERT INTO pm_tickets (id, epic_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
      't-2',
      'epic-2',
      'Ticket B',
      0
    );

    const result = getEpicWithTickets(db, 'epic-1');

    expect(result!.tickets).toHaveLength(1);
    expect(result!.tickets[0].id).toBe('t-1');
  });
});

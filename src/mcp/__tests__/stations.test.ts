import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createGoal } from '../tools/goals';
import {
  createStation,
  listStations,
  markStationDone,
  reorderStation,
  resolveStationId,
  updateStation,
} from '../tools/stations';
import { createTestDb } from '../db';

describe('station tools', () => {
  let db: Database.Database;
  let goalId: string;

  beforeEach(() => {
    db = createTestDb();
    goalId = createGoal(db, { name: 'Ship the feature' }, 'mcp').id;
  });

  afterEach(() => {
    db.close();
  });

  it('creates stations in order with dense sort orders', () => {
    createStation(db, { goalId, name: 'First' });
    createStation(db, { goalId, name: 'Second' });
    const rows = listStations(db, goalId);
    expect(rows.map((r) => r.name)).toEqual(['First', 'Second']);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
  });

  it('inserts after a given station', () => {
    const a = createStation(db, { goalId, name: 'A' });
    createStation(db, { goalId, name: 'C' });
    createStation(db, { goalId, name: 'B', afterStationId: a.id });
    expect(listStations(db, goalId).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('human stations default to a human predicate and evidence', () => {
    const s = createStation(db, { goalId, name: 'Call the client', kind: 'human' });
    expect(s.kind).toBe('human');
    expect(s.evidence_kind).toBe('human');
    expect(JSON.parse(s.predicate)).toEqual({ type: 'human' });
  });

  it('rejects invalid predicates with a precise message', () => {
    expect(() =>
      createStation(db, { goalId, name: 'X', predicate: '{"type":"telepathy"}' })
    ).toThrow(/predicate\.type.*telepathy/);
    expect(() => createStation(db, { goalId, name: 'X', predicate: 'not json' })).toThrow(
      /valid JSON/
    );
  });

  it('mark_station_done always records a claim — never proof', () => {
    const s = createStation(db, { goalId, name: 'Build it' });
    const done = markStationDone(db, s.id, 'implemented in src/feature.ts');
    expect(done.status).toBe('done');
    expect(done.evidence_kind).toBe('claim');
    expect(done.done_at).not.toBeNull();
  });

  it('mark_station_done resets last_checked_at so a re-claim is judged anew', () => {
    const s = createStation(db, { goalId, name: 'Build it' });
    // A prior judge ruling stamped last_checked_at; a re-claim must clear it.
    db.prepare('UPDATE pm_goal_stations SET last_checked_at = ? WHERE id = ?').run(
      '2026-01-01 00:00:00',
      s.id
    );
    const done = markStationDone(db, s.id, 'reimplemented it');
    expect(done.last_checked_at).toBeNull();
  });

  it('refuses to mark a human station done — only a person can tick it', () => {
    const s = createStation(db, { goalId, name: 'Call the customer', kind: 'human' });
    expect(() => markStationDone(db, s.id, 'agent asserts it called')).toThrow(/human step/i);
    // and it stays exactly where it was
    expect(listStations(db, goalId)[0].status).toBe('planned');
  });

  it('a human station cannot carry a machine predicate an agent could clear', () => {
    const s = createStation(db, {
      goalId,
      name: 'Sign off',
      kind: 'human',
      predicate: '{"type":"file_exists","glob":"docs/x.md"}',
    });
    expect(JSON.parse(s.predicate)).toEqual({ type: 'human' });
  });

  it('validates every predicate field at the boundary, not just the type', () => {
    expect(() =>
      createStation(db, { goalId, name: 'X', predicate: '{"type":"git_touches"}' })
    ).toThrow(/pathPrefix/);
    expect(() =>
      createStation(db, { goalId, name: 'X', predicate: '{"type":"file_exists"}' })
    ).toThrow(/glob/);
  });

  it('rejects a tautological glob that would match every path', () => {
    expect(() =>
      createStation(db, { goalId, name: 'X', predicate: '{"type":"file_exists","glob":"**"}' })
    ).toThrow(/glob/i);
  });

  it('reorder clamps so pending work never precedes done work', () => {
    const a = createStation(db, { goalId, name: 'A' });
    createStation(db, { goalId, name: 'B' });
    const c = createStation(db, { goalId, name: 'C' });
    markStationDone(db, a.id, 'done first');

    const rows = reorderStation(db, c.id, 0);
    expect(rows.map((r) => r.name)).toEqual(['A', 'C', 'B']);
  });

  it('resolves station ids by unique prefix and rejects ambiguity', () => {
    const s = createStation(db, { goalId, name: 'Only' });
    expect(resolveStationId(db, s.id.slice(0, 8))).toBe(s.id);
    expect(() => resolveStationId(db, 'nope-')).toThrow(/not found/);
  });

  it('links a resolved ticket when updating a station', () => {
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('e1', 'Epic');
    db.prepare('INSERT INTO pm_tickets (id, epic_id, name) VALUES (?, ?, ?)').run(
      'ticket-123',
      'e1',
      'Build it'
    );
    const station = createStation(db, { goalId, name: 'Build' });

    expect(updateStation(db, station.id, { ticketId: 'ticket' }).ticket_id).toBe('ticket-123');
    expect(() => updateStation(db, station.id, { ticketId: 'missing' })).toThrow(/no tickets/i);
  });

  it('deleting the goal cascades to its stations', () => {
    createStation(db, { goalId, name: 'Doomed' });
    db.prepare('DELETE FROM pm_goals WHERE id = ?').run(goalId);
    expect(listStations(db, goalId)).toHaveLength(0);
  });
});

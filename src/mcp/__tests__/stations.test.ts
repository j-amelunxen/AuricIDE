import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { createGoal } from '../tools/goals';
import {
  createStation,
  listStations,
  markStationDone,
  reorderStation,
  requestHumanCheck,
  resolveStationId,
  stationRowToDomain,
  updateStation,
} from '../tools/stations';
import { createTestDb } from '../db';
import { createTestNotificationsDb } from '../notificationsDb';

/** A project root no machine-checkable test station ever looks at. */
const NO_ROOT = '/nonexistent-project-root';

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

  it('mark_station_done records a claim when no machine check decides the station', async () => {
    const s = createStation(db, { goalId, name: 'Build it' });
    const done = await markStationDone(db, s.id, 'implemented in src/feature.ts', NO_ROOT);
    expect(done.status).toBe('done');
    expect(done.evidence_kind).toBe('claim');
    expect(done.done_at).not.toBeNull();
  });

  it('mark_station_done resets last_checked_at so a re-claim is judged anew', async () => {
    const s = createStation(db, { goalId, name: 'Build it' });
    // A prior judge ruling stamped last_checked_at; a re-claim must clear it.
    db.prepare('UPDATE pm_goal_stations SET last_checked_at = ? WHERE id = ?').run(
      '2026-01-01 00:00:00',
      s.id
    );
    const done = await markStationDone(db, s.id, 'reimplemented it', NO_ROOT);
    expect(done.last_checked_at).toBeNull();
  });

  it('refuses to mark a human station done — only a person can tick it', async () => {
    const s = createStation(db, { goalId, name: 'Call the customer', kind: 'human' });
    await expect(markStationDone(db, s.id, 'agent asserts it called', NO_ROOT)).rejects.toThrow(
      /human step/i
    );
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

  it('degrades corrupt stored predicates when mapping a row to the domain shape', () => {
    const s = createStation(db, { goalId, name: 'Legacy' });
    db.prepare('UPDATE pm_goal_stations SET predicate = ? WHERE id = ?').run(
      '{"type":"file_exists"}',
      s.id
    );
    const row = listStations(db, goalId)[0];
    // Raw storage is untouched — read path must not rewrite the DB.
    expect(JSON.parse(row.predicate)).toEqual({ type: 'file_exists' });
    // Domain shape degrades incomplete predicates so they cannot become machine proof.
    expect(stationRowToDomain(row).predicate).toEqual({ type: 'undefined' });
  });

  it('reorder clamps so pending work never precedes done work', async () => {
    const a = createStation(db, { goalId, name: 'A' });
    createStation(db, { goalId, name: 'B' });
    const c = createStation(db, { goalId, name: 'C' });
    await markStationDone(db, a.id, 'done first', NO_ROOT);

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

describe('mark_station_done on a station with a machine predicate', () => {
  let db: Database.Database;
  let goalId: string;
  let root: string;

  const touch = (rel: string) => {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'x');
  };
  const fileStation = (glob: string) =>
    createStation(db, {
      goalId,
      name: 'Write the plan',
      predicate: JSON.stringify({ type: 'file_exists', glob }),
    });

  beforeEach(() => {
    db = createTestDb();
    goalId = createGoal(db, { name: 'Ship the feature' }, 'mcp').id;
    root = mkdtempSync(join(tmpdir(), 'auric-stations-'));
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('records proof when the file exists, keeping the check result and the agent note', async () => {
    touch('docs/plan.md');
    const s = fileStation('docs/*.md');

    const done = await markStationDone(db, s.id, 'wrote the plan', root);

    expect(done.status).toBe('done');
    expect(done.evidence_kind).toBe('proof');
    expect(done.evidence_note).toBe('docs/*.md exists — wrote the plan');
    expect(done.last_checked_at).not.toBeNull();
    expect(done.done_at).not.toBeNull();
  });

  it('refuses when the file is missing and leaves the station open', async () => {
    const s = fileStation('docs/plan.md');

    await expect(markStationDone(db, s.id, 'wrote the plan', root)).rejects.toThrow(
      /docs\/plan\.md does not exist/
    );

    const row = listStations(db, goalId)[0];
    expect(row.status).toBe('planned');
    expect(row.evidence_note).toBe('');
  });

  it("does not count files the IDE's own file list leaves out", async () => {
    touch('node_modules/pkg/plan.md');
    touch('.auric/plan.md');
    const s = fileStation('plan.md');

    await expect(markStationDone(db, s.id, 'wrote it', root)).rejects.toThrow(/does not exist/);
  });

  it('checks ticket_done and requirement_verified against the database', async () => {
    db.prepare("INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic')").run();
    db.prepare(
      "INSERT INTO pm_tickets (id, epic_id, name, status) VALUES ('t1', 'e1', 'Build it', 'open')"
    ).run();
    db.prepare(
      "INSERT INTO pm_requirements (id, req_id, title, status) VALUES ('r1', 'REQ-X-01', 'X', 'verified')"
    ).run();
    const ticket = createStation(db, {
      goalId,
      name: 'Ticket',
      predicate: '{"type":"ticket_done","ticketId":"t1"}',
    });
    const req = createStation(db, {
      goalId,
      name: 'Requirement',
      predicate: '{"type":"requirement_verified","requirementId":"r1"}',
    });

    await expect(markStationDone(db, ticket.id, 'did it', root)).rejects.toThrow(/is open/);
    db.prepare("UPDATE pm_tickets SET status = 'done' WHERE id = 't1'").run();
    expect((await markStationDone(db, ticket.id, 'did it', root)).evidence_kind).toBe('proof');
    expect((await markStationDone(db, req.id, 'verified', root)).evidence_kind).toBe('proof');
  });

  it('leaves judged and git stations a claim for the engine to settle', async () => {
    const judged = createStation(db, {
      goalId,
      name: 'Copy reads well',
      predicate: '{"type":"judged","prompt":"Is it clear?"}',
    });
    const git = createStation(db, {
      goalId,
      name: 'Commit it',
      predicate: '{"type":"git_touches","pathPrefix":"src/"}',
    });
    for (const s of [judged, git]) {
      const done = await markStationDone(db, s.id, 'done', root);
      expect(done.evidence_kind).toBe('claim');
      expect(done.last_checked_at).toBeNull();
    }
  });
});

describe('request_human_check', () => {
  let db: Database.Database;
  let inbox: Database.Database;
  let goalId: string;
  const where = { projectPath: '/repo', projectName: 'repo' };

  beforeEach(() => {
    db = createTestDb();
    inbox = createTestNotificationsDb();
    goalId = createGoal(db, { name: 'Voice feels natural' }, 'mcp').id;
  });

  afterEach(() => {
    db.close();
    inbox.close();
  });

  const rows = () =>
    inbox.prepare('SELECT * FROM notifications ORDER BY id').all() as {
      title: string;
      body: string;
      severity: string;
      source: string;
      ref_kind: string;
      ref_id: string;
      dedupe_key: string;
      project_path: string;
    }[];

  it('stores the steps on the station and leaves it open', () => {
    const s = createStation(db, { goalId, name: 'Test the speakers', kind: 'human' });
    const result = requestHumanCheck(db, inbox, s.id, '1. Start the server', where);
    expect(result.station.evidence_note).toBe('1. Start the server');
    expect(result.station.status).toBe('planned');
    expect(result.station.evidence_kind).toBe('human');
    expect(result.station.done_at).toBeNull();
    expect(result.notified).toBe(true);
  });

  it('writes one warning that opens the goal, again only once when asked twice', () => {
    const s = createStation(db, { goalId, name: 'Test the speakers', kind: 'human' });
    requestHumanCheck(db, inbox, s.id, 'first', where);
    requestHumanCheck(db, inbox, s.id, 'second', where);
    const written = rows();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      title: 'Test the speakers',
      body: 'second',
      severity: 'warn',
      source: 'agent',
      ref_kind: 'goal',
      ref_id: goalId,
      dedupe_key: `station:${s.id}:human-check`,
      project_path: '/repo',
    });
  });

  it('refuses a station an agent can do itself', () => {
    const s = createStation(db, { goalId, name: 'Build it' });
    expect(() => requestHumanCheck(db, inbox, s.id, 'check', where)).toThrow(/not a human/i);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a human station a person already ticked', () => {
    const s = createStation(db, { goalId, name: 'Sign off', kind: 'human' });
    db.prepare("UPDATE pm_goal_stations SET status = 'done' WHERE id = ?").run(s.id);
    expect(() => requestHumanCheck(db, inbox, s.id, 'check', where)).toThrow(/already done/i);
    expect(rows()).toHaveLength(0);
  });

  it('still records the steps when no inbox is reachable, and says nobody was told', () => {
    const s = createStation(db, { goalId, name: 'Sign off', kind: 'human' });
    const result = requestHumanCheck(db, null, s.id, 'look at it', where);
    expect(result.station.evidence_note).toBe('look at it');
    expect(result.notified).toBe(false);
  });
});

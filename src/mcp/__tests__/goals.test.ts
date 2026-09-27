import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { GOAL_STATUSES } from '../../lib/pm/enums';
import type Database from 'better-sqlite3';
import {
  createGoal,
  evaluateGoal,
  getGoal,
  listGoals,
  registerGoalTools,
  updateGoal,
} from '../tools/goals';
import { createTestDb } from '../db';

function seedEpic(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run(id, 'Epic');
}

function seedTicket(db: Database.Database, id: string, goalId: string, status: string): void {
  db.prepare(
    'INSERT INTO pm_tickets (id, epic_id, name, status, goal_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, 'epic-1', `Ticket ${id}`, status, goalId);
}

function seedStation(
  db: Database.Database,
  id: string,
  goalId: string,
  name: string,
  status: string,
  evidenceKind = 'human'
): void {
  db.prepare(
    `INSERT INTO pm_goal_stations (id, goal_id, name, kind, status, evidence_kind, predicate)
     VALUES (?, ?, ?, 'normal', ?, ?, '{"type":"undefined"}')`
  ).run(id, goalId, name, status, evidenceKind);
}

describe('evaluateGoal — the SQL twin of getGoalSatisfaction', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedEpic(db, 'epic-1');
  });

  afterEach(() => {
    db.close();
  });

  it('refuses vacuous satisfaction for a goal with nothing attached', () => {
    const goal = createGoal(db, { name: 'Bare goal' }, 'mcp');
    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(false);
    expect(result.blockers.join(' ')).toContain('Add work before running the conductor');
  });

  it('is satisfied when all attached tickets are done', () => {
    const goal = createGoal(db, { name: 'Done goal' }, 'mcp');
    seedTicket(db, 't1', goal.id, 'done');
    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(true);
  });

  it('a to_test ticket is not done, so the goal is not satisfied', () => {
    const goal = createGoal(db, { name: 'Testing goal' }, 'mcp');
    seedTicket(db, 't1', goal.id, 'to_test');
    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(false);
    expect(result.blockers.some((b) => b.includes('to_test'))).toBe(true);
  });

  it('a discarded ticket is cancelled work and does not block the goal', () => {
    const goal = createGoal(db, { name: 'Cancelled goal' }, 'mcp');
    seedTicket(db, 't1', goal.id, 'discarded');
    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  // The LOCKSTEP FIXTURE: identical scenario asserted on the TS side in
  // src/lib/store/goalsSlice.test.ts ("lockstep: an open human station
  // blocks satisfaction"). If either side is changed without the other,
  // one of the two tests fails.
  it('lockstep: an open human station blocks satisfaction even when all tickets are done', () => {
    const goal = createGoal(db, { name: 'Ship the offer' }, 'mcp');
    seedTicket(db, 't1', goal.id, 'done');
    seedStation(db, 's1', goal.id, 'Call the customer', 'planned');

    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(false);
    expect(result.blockers).toContain('Station "Call the customer" is planned');
  });

  it('a done station does not block, and stations alone defeat vacuousness', () => {
    const goal = createGoal(db, { name: 'Stations only' }, 'mcp');
    seedStation(db, 's1', goal.id, 'Call the customer', 'done');
    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(true);
  });

  // LOCKSTEP twin of goalsSlice.test.ts ("a claimed station blocks
  // satisfaction until verified"): a station an agent only claimed done must
  // not satisfy — only proof/judged/human count.
  it('lockstep: a claimed station blocks satisfaction until verified', () => {
    const goal = createGoal(db, { name: 'Ship it' }, 'mcp');
    seedStation(db, 's1', goal.id, 'Build the parser', 'done', 'claim');
    const result = evaluateGoal(db, goal.id);
    expect(result.satisfied).toBe(false);
    expect(result.blockers).toContain('Station "Build the parser": unverified claim');
  });

  it('a judged, proof, or human station satisfies', () => {
    for (const kind of ['judged', 'proof', 'human']) {
      const goal = createGoal(db, { name: `verified-${kind}` }, 'mcp');
      seedStation(db, `s-${kind}`, goal.id, 'Verified step', 'done', kind);
      expect(evaluateGoal(db, goal.id).satisfied).toBe(true);
    }
  });

  it('counts stations of subtree goals against the root', () => {
    const root = createGoal(db, { name: 'Root' }, 'mcp');
    const child = createGoal(db, { name: 'Child', parentId: root.id }, 'mcp');
    db.prepare("UPDATE pm_goals SET status = 'achieved' WHERE id = ?").run(child.id);
    seedStation(db, 's1', child.id, 'Child step', 'planned');

    const result = evaluateGoal(db, root.id);
    expect(result.satisfied).toBe(false);
    expect(result.blockers).toContain('Station "Child step" is planned');
  });
});

describe('goal tools: the status vocabulary', () => {
  function statusParams(db: Database.Database) {
    const addTool = vi.spyOn(FastMCP.prototype, 'addTool');
    registerGoalTools(new FastMCP({ name: 'test', version: '1.0.0' }), db);
    const tools = addTool.mock.calls.map(
      ([t]) => t as unknown as { name: string; parameters: z.ZodObject<z.ZodRawShape> }
    );
    addTool.mockRestore();
    return ['list_goals', 'create_goal', 'update_goal'].map((name) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`${name} was not registered`);
      return { name, status: tool.parameters.shape.status as z.ZodType };
    });
  }

  it('accepts every goal status, in_review included, and nothing else', () => {
    const db = createTestDb();
    for (const { name, status } of statusParams(db)) {
      for (const value of GOAL_STATUSES) {
        expect(status.safeParse(value).success, `${name} ${value}`).toBe(true);
      }
      expect(status.safeParse('in_review').success, name).toBe(true);
      expect(status.safeParse('done').success, name).toBe(false);
    }
    db.close();
  });

  it('stores and filters a goal in review without stamping it achieved', () => {
    const db = createTestDb();
    const goal = createGoal(db, { name: 'Under review' }, 'mcp');
    updateGoal(db, goal.id, { status: 'in_review' });
    expect(getGoal(db, goal.id)).toMatchObject({ status: 'in_review', achieved_at: null });
    expect(listGoals(db, { status: 'in_review' }).map((g) => g.id)).toEqual([goal.id]);
    db.close();
  });
});

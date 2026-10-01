import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import { createGoal, recordGoalRun, registerGoalTools } from '../tools/goals';
import { createTestDb } from '../db';

/**
 * What an agent actually reads from the goal tools. These answers are paid for
 * on every later turn of the agent's context, so they stay small by default
 * and say plainly what is blocking.
 */

type Execute = (args: Record<string, unknown>) => Promise<string>;

function goalTools(db: Database.Database): Record<string, Execute> {
  const addTool = vi.spyOn(FastMCP.prototype, 'addTool');
  registerGoalTools(new FastMCP({ name: 'test', version: '1.0.0' }), db);
  const tools = Object.fromEntries(
    addTool.mock.calls.map(([tool]) => {
      const { name, execute } = tool as unknown as { name: string; execute: Execute };
      return [name, execute];
    })
  );
  addTool.mockRestore();
  return tools;
}

function seedStation(
  db: Database.Database,
  row: {
    id: string;
    goalId: string;
    name: string;
    status: string;
    evidenceKind: string;
    note?: string;
    lastCheckedAt?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO pm_goal_stations
       (id, goal_id, name, kind, status, evidence_kind, evidence_note, last_checked_at, predicate)
     VALUES (?, ?, ?, 'normal', ?, ?, ?, ?, '{"type":"undefined"}')`
  ).run(
    row.id,
    row.goalId,
    row.name,
    row.status,
    row.evidenceKind,
    row.note ?? '',
    row.lastCheckedAt ?? null
  );
}

const LONG = 'x'.repeat(2000);

describe('list_goals: summary rows by default', () => {
  let db: Database.Database;
  let tools: Record<string, Execute>;

  beforeEach(() => {
    db = createTestDb();
    tools = goalTools(db);
    createGoal(
      db,
      { name: 'Onboard FC Example', successCriteria: LONG, goalPrompt: LONG, description: LONG },
      'mcp'
    );
  });

  it('leaves the long text fields out', async () => {
    const [row] = JSON.parse(await tools.list_goals({})) as Record<string, unknown>[];
    expect(row).toMatchObject({ name: 'Onboard FC Example', status: 'draft' });
    expect(row).toHaveProperty('id');
    expect(row).not.toHaveProperty('success_criteria');
    expect(row).not.toHaveProperty('goal_prompt');
    expect(row).not.toHaveProperty('description');
  });

  it('returns every column with verbose: true', async () => {
    const [row] = JSON.parse(await tools.list_goals({ verbose: true })) as Record<
      string,
      unknown
    >[];
    expect(row.success_criteria).toBe(LONG);
    expect(row.goal_prompt).toBe(LONG);
  });
});

describe('get_goal: run prompts are not repeated', () => {
  it('replaces each run prompt with its length unless asked for', async () => {
    const db = createTestDb();
    const tools = goalTools(db);
    const goal = createGoal(db, { name: 'Goal with runs' }, 'mcp');
    recordGoalRun(db, { goalId: goal.id, agentId: 'agent-1', prompt: LONG });
    recordGoalRun(db, { goalId: goal.id, agentId: 'agent-2', prompt: LONG });

    const compact = JSON.parse(await tools.get_goal({ id: goal.id })) as {
      runs: Record<string, unknown>[];
    };
    expect(compact.runs).toHaveLength(2);
    for (const run of compact.runs) {
      expect(run).not.toHaveProperty('prompt');
      expect(run.prompt_chars).toBe(LONG.length);
    }

    const full = JSON.parse(await tools.get_goal({ id: goal.id, includeRunPrompts: true })) as {
      runs: Record<string, unknown>[];
    };
    expect(full.runs[0].prompt).toBe(LONG);
  });
});

describe('evaluate_goal: blocking stations come with id, state and reason', () => {
  it('tells a judge rejection apart from a claim still waiting for the judge', async () => {
    const db = createTestDb();
    const tools = goalTools(db);
    const goal = createGoal(db, { name: 'R070' }, 'mcp');
    seedStation(db, {
      id: 'st-rejected',
      goalId: goal.id,
      name: 'Built + tests green',
      status: 'done',
      evidenceKind: 'claim',
      note: 'rejected: The claim does not show the tests ran.',
      lastCheckedAt: '2026-09-30 21:36:12',
    });
    seedStation(db, {
      id: 'st-waiting',
      goalId: goal.id,
      name: 'Merged',
      status: 'done',
      evidenceKind: 'claim',
      note: 'merge commit abc',
    });
    seedStation(db, {
      id: 'st-open',
      goalId: goal.id,
      name: 'Review passed',
      status: 'planned',
      evidenceKind: 'proof',
    });
    seedStation(db, {
      id: 'st-done',
      goalId: goal.id,
      name: 'Identity',
      status: 'done',
      evidenceKind: 'proof',
    });

    const result = JSON.parse(await tools.evaluate_goal({ id: goal.id })) as {
      blockers: string[];
      blockingStations: Record<string, unknown>[];
    };

    // The lockstep blocker strings stay as they are.
    expect(result.blockers).toContain('Station "Built + tests green": unverified claim');
    expect(result.blockingStations).toEqual([
      {
        stationId: 'st-rejected',
        goalId: goal.id,
        name: 'Built + tests green',
        state: 'rejected_by_judge',
        reason: 'The claim does not show the tests ran.',
      },
      {
        stationId: 'st-waiting',
        goalId: goal.id,
        name: 'Merged',
        state: 'awaiting_judge',
        reason: null,
      },
      {
        stationId: 'st-open',
        goalId: goal.id,
        name: 'Review passed',
        state: 'planned',
        reason: null,
      },
    ]);
  });
});

describe('find_goals: look a goal up by name', () => {
  let db: Database.Database;
  let tools: Record<string, Execute>;

  beforeEach(() => {
    db = createTestDb();
    tools = goalTools(db);
    createGoal(db, { name: 'R070 FC Puplinge: onboarded', goalPrompt: LONG }, 'mcp');
    createGoal(db, { name: 'R071 FC Rapid-Jonction', status: 'active' }, 'mcp');
    createGoal(db, { name: 'Image pipeline' }, 'mcp');
  });

  it('matches part of the name, ignoring case, and returns summary rows', async () => {
    const rows = JSON.parse(await tools.find_goals({ query: 'puplinge' })) as Record<
      string,
      unknown
    >[];
    expect(rows.map((row) => row.name)).toEqual(['R070 FC Puplinge: onboarded']);
    expect(rows[0]).not.toHaveProperty('goal_prompt');
  });

  it('filters by status and caps the result', async () => {
    const active = JSON.parse(await tools.find_goals({ query: 'FC', status: 'active' })) as {
      name: string;
    }[];
    expect(active.map((row) => row.name)).toEqual(['R071 FC Rapid-Jonction']);

    const capped = JSON.parse(await tools.find_goals({ query: 'R07', limit: 1 })) as unknown[];
    expect(capped).toHaveLength(1);
  });

  it('treats % and _ in the query as plain characters', async () => {
    expect(JSON.parse(await tools.find_goals({ query: '%' }))).toEqual([]);
  });
});

describe('goal id errors point to find_goals', () => {
  it('suggests find_goals when a name is passed where an id belongs', async () => {
    const db = createTestDb();
    const tools = goalTools(db);
    createGoal(db, { name: 'R070 FC Puplinge' }, 'mcp');
    await expect(tools.get_goal({ id: 'R070 FC Puplinge' })).rejects.toThrow(/find_goals/);
  });
});

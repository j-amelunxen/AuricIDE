import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { createTestDb } from '../db';
import {
  buildGoalLaunchPrompt,
  buildGoalPlanningPrompt,
  buildMetaGoalSplitPrompt,
} from '../../lib/goals/goalLaunchPrompt';
import { getGoalWorkMode } from '../../lib/store/goals/goalSatisfaction';
import type { PmGoal, PmGoalStation } from '../../lib/tauri/goals';
import { createGoal } from './goalsDb';
import { createStations, listStations } from './stations';
import { createEpic } from './epics';
import { createTicket } from './tickets';
import { getGoalLaunchPrompt, registerGoalLaunchTools } from './goalLaunch';

/** What the Goals panel holds in its store for the same goal, built the way the UI builds it. */
function uiGoal(row: ReturnType<typeof createGoal>): PmGoal {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    successCriteria: row.success_criteria,
    status: row.status as PmGoal['status'],
    priority: row.priority as PmGoal['priority'],
    goalPrompt: row.goal_prompt,
    workMode: row.work_mode as PmGoal['workMode'],
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uiStations(db: Database.Database, goalId: string): PmGoalStation[] {
  return listStations(db, goalId).map((s) => ({
    id: s.id,
    goalId: s.goal_id,
    name: s.name,
    kind: s.kind,
    sortOrder: s.sort_order,
  })) as unknown as PmGoalStation[];
}

describe('get_goal_launch_prompt (same text as the Goals panel)', () => {
  let db: Database.Database;
  let row: ReturnType<typeof createGoal>;

  beforeEach(() => {
    db = createTestDb();
    row = createGoal(
      db,
      {
        name: 'Publish the guide',
        description: 'The guide is online',
        successCriteria: '- page returns 200',
        goalPrompt: 'Keep it short.',
      },
      'test'
    );
    createStations(db, {
      goalId: row.id,
      stations: [{ name: 'Write it' }, { name: 'Check it', kind: 'human' }],
    });
  });

  it('matches buildGoalLaunchPrompt for a goal worked by stations', () => {
    const goal = uiGoal(row);
    const stations = uiStations(db, row.id);
    const ui = getGoalWorkMode([goal], [], stations, row.id);
    expect(ui.mode).toBe('stations');

    const mcp = getGoalLaunchPrompt(db, row.id, 'work');
    expect(mcp.mode).toBe('stations');
    expect(mcp.prompt).toBe(buildGoalLaunchPrompt(goal, stations, ui.mode));
    expect(mcp.prompt.startsWith('/goal\n\n')).toBe(true);
  });

  it('matches the unattended variant, which has no /goal command', () => {
    const goal = uiGoal(row);
    const stations = uiStations(db, row.id);
    const mcp = getGoalLaunchPrompt(db, row.id, 'work', true);
    expect(mcp.prompt).toBe(
      buildGoalLaunchPrompt(goal, stations, 'stations', { unattended: true })
    );
    expect(mcp.prompt.startsWith('/goal')).toBe(false);
  });

  it('switches to the ticket contract once the goal has a ticket', () => {
    const epic = createEpic(db, { name: 'Epic' });
    const ticket = createTicket(db, { epicId: epic.id, name: 'T', goalId: row.id });
    expect(ticket.goal_id).toBe(row.id);

    const goal = uiGoal(row);
    const stations = uiStations(db, row.id);
    const mcp = getGoalLaunchPrompt(db, row.id, 'work');
    expect(mcp.mode).toBe('tickets');
    expect(mcp.prompt).toBe(buildGoalLaunchPrompt(goal, stations, 'tickets'));
  });

  it('matches the planning and the split prompt', () => {
    const goal = uiGoal(row);
    expect(getGoalLaunchPrompt(db, row.id, 'plan').prompt).toBe(buildGoalPlanningPrompt(goal));
    expect(getGoalLaunchPrompt(db, row.id, 'split').prompt).toBe(buildMetaGoalSplitPrompt(goal));
  });

  it('refuses an unknown goal', () => {
    expect(() => getGoalLaunchPrompt(db, 'nope')).toThrow(/not found/);
  });

  it('is exposed as a tool that resolves a goal id prefix', async () => {
    const tools = new Map<string, { execute: (a: Record<string, unknown>) => Promise<string> }>();
    registerGoalLaunchTools(
      { addTool: (t: { name: string }) => tools.set(t.name, t as never) } as unknown as FastMCP,
      db
    );
    const out = JSON.parse(
      await tools.get('get_goal_launch_prompt')!.execute({ goalId: row.id.slice(0, 8) })
    ) as { goalId: string; mode: string };
    expect(out.goalId).toBe(row.id);
    expect(out.mode).toBe('stations');
  });
});

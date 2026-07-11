import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import {
  createGoalsSlice,
  type GoalsSlice,
  getRootGoals,
  getGoalChildren,
  getGoalDescendants,
  getGoalProgress,
  getGoalSatisfaction,
  getRunsForGoal,
  getGoalWorkflowStage,
} from './goalsSlice';
import type { GoalsState, PmGoal, PmGoalRun } from '../tauri/goals';
import type { PmTicket } from '../tauri/pm';
import type { PmRequirement } from '../tauri/requirements';

const mockGoalsLoad = vi.fn<(...args: unknown[]) => Promise<GoalsState>>(() =>
  Promise.resolve({ goals: [], goalRuns: [], requirementLinks: [] })
);
const mockGoalsSave = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockGoalsClear = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockInitProjectDb = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());

vi.mock('../tauri/goals', () => ({
  goalsLoad: (...args: unknown[]) => mockGoalsLoad(...args),
  goalsSave: (...args: unknown[]) => mockGoalsSave(...args),
  goalsClear: (...args: unknown[]) => mockGoalsClear(...args),
}));

vi.mock('../tauri/db', () => ({
  initProjectDb: (...args: unknown[]) => mockInitProjectDb(...args),
}));

function createTestStore() {
  return create<GoalsSlice>()((...a) => ({ ...createGoalsSlice(...a) }));
}

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Ship orchestration',
    description: 'Full orchestration layer',
    successCriteria: '- All sub-goals achieved',
    status: 'active',
    priority: 'high',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

function makeRun(overrides: Partial<PmGoalRun> = {}): PmGoalRun {
  return {
    id: 'run1',
    goalId: 'g1',
    agentId: 'agent-1',
    ticketId: null,
    prompt: 'Do the thing',
    model: 'sonnet',
    provider: 'claude',
    source: 'ui',
    outcome: 'running',
    summary: '',
    startedAt: '2026-01-01 00:00:00',
    finishedAt: null,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: '2026-01-01 00:00:00',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

function makeRequirement(overrides: Partial<PmRequirement> = {}): PmRequirement {
  return {
    id: 'r1',
    reqId: 'REQ-01',
    title: 'Requirement',
    description: '',
    type: 'functional',
    category: '',
    priority: 'normal',
    status: 'active',
    rationale: '',
    acceptanceCriteria: '',
    source: '',
    lastVerifiedAt: null,
    appliesTo: [],
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('goalsSlice tree helpers', () => {
  const goals = [
    makeGoal({ id: 'root1' }),
    makeGoal({ id: 'root2' }),
    makeGoal({ id: 'child1', parentId: 'root1' }),
    makeGoal({ id: 'grandchild1', parentId: 'child1' }),
  ];

  it('getRootGoals returns only goals without parent', () => {
    expect(getRootGoals(goals).map((g) => g.id)).toEqual(['root1', 'root2']);
  });

  it('getGoalChildren returns direct children', () => {
    expect(getGoalChildren(goals, 'root1').map((g) => g.id)).toEqual(['child1']);
    expect(getGoalChildren(goals, 'root2')).toEqual([]);
  });

  it('getGoalDescendants returns all transitive descendants', () => {
    expect(
      getGoalDescendants(goals, 'root1')
        .map((g) => g.id)
        .sort()
    ).toEqual(['child1', 'grandchild1']);
    expect(getGoalDescendants(goals, 'grandchild1')).toEqual([]);
  });

  it('getGoalDescendants survives corrupted cyclic parent references', () => {
    const cyclic = [makeGoal({ id: 'a', parentId: 'b' }), makeGoal({ id: 'b', parentId: 'a' })];
    // Must terminate and not blow the stack
    expect(getGoalDescendants(cyclic, 'a').map((g) => g.id)).toEqual(['b']);
  });
});

describe('goalsSlice progress + satisfaction', () => {
  it('getGoalProgress counts tickets of goal and descendants', () => {
    const goals = [makeGoal({ id: 'g1' }), makeGoal({ id: 'g2', parentId: 'g1' })];
    const tickets = [
      makeTicket({ id: 't1', goalId: 'g1', status: 'done' }),
      makeTicket({ id: 't2', goalId: 'g2', status: 'open' }),
      makeTicket({ id: 't3', goalId: 'g2', status: 'done' }),
      makeTicket({ id: 't4', goalId: null }),
    ];
    const progress = getGoalProgress(goals, tickets, 'g1');
    expect(progress.totalTickets).toBe(3);
    expect(progress.doneTickets).toBe(2);
  });

  it('getGoalSatisfaction reports satisfied when tickets done, requirements verified, children achieved', () => {
    const goals = [
      makeGoal({ id: 'g1' }),
      makeGoal({ id: 'g2', parentId: 'g1', status: 'achieved' }),
    ];
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })];
    const requirements = [makeRequirement({ id: 'r1', status: 'verified' })];
    const links = [{ id: 'l1', goalId: 'g1', requirementId: 'r1', createdAt: '' }];

    const result = getGoalSatisfaction(goals, tickets, requirements, links, 'g1');
    expect(result.satisfied).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('getGoalSatisfaction refuses vacuous satisfaction for empty goals', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const result = getGoalSatisfaction(goals, [], [], [], 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers.join(' ')).toContain('nothing to verify');
  });

  it('getGoalSatisfaction lists precise blockers', () => {
    const goals = [
      makeGoal({ id: 'g1' }),
      makeGoal({ id: 'g2', parentId: 'g1', status: 'active', name: 'Sub goal' }),
    ];
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'open', name: 'Open work' })];
    const requirements = [makeRequirement({ id: 'r1', status: 'active', reqId: 'REQ-01' })];
    const links = [{ id: 'l1', goalId: 'g1', requirementId: 'r1', createdAt: '' }];

    const result = getGoalSatisfaction(goals, tickets, requirements, links, 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers.length).toBe(3);
    expect(result.blockers.join(' ')).toContain('Open work');
    expect(result.blockers.join(' ')).toContain('REQ-01');
    expect(result.blockers.join(' ')).toContain('Sub goal');
  });

  it('getRunsForGoal filters runs, newest first', () => {
    const runs = [
      makeRun({ id: 'a', goalId: 'g1', startedAt: '2026-01-01 00:00:00' }),
      makeRun({ id: 'b', goalId: 'g2' }),
      makeRun({ id: 'c', goalId: 'g1', startedAt: '2026-01-02 00:00:00' }),
    ];
    expect(getRunsForGoal(runs, 'g1').map((r) => r.id)).toEqual(['c', 'a']);
  });
});

describe('goalsSlice draft CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addGoal appends to draft and marks dirty', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    expect(store.getState().goalsDraft.length).toBe(1);
    expect(store.getState().goalsDirty).toBe(true);
    expect(store.getState().goals.length).toBe(0);
  });

  it('updateGoal patches draft goal and bumps updatedAt', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ updatedAt: '2020-01-01 00:00:00' }));
    store.getState().updateGoal('g1', { name: 'Renamed' });
    const goal = store.getState().goalsDraft[0];
    expect(goal.name).toBe('Renamed');
    expect(goal.updatedAt).not.toBe('2020-01-01 00:00:00');
  });

  it('deleteGoal cascades to descendants, runs, and requirement links', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ id: 'g1' }));
    store.getState().addGoal(makeGoal({ id: 'g2', parentId: 'g1' }));
    store.getState().addGoal(makeGoal({ id: 'g3' }));
    store.getState().recordGoalRun(makeRun({ id: 'run-g2', goalId: 'g2' }));
    store.getState().linkRequirementToGoal('g2', 'r1');

    store.getState().deleteGoal('g1');

    expect(store.getState().goalsDraft.map((g) => g.id)).toEqual(['g3']);
    expect(store.getState().goalRunsDraft.length).toBe(0);
    expect(store.getState().goalRequirementLinksDraft.length).toBe(0);
  });

  it('achieveGoal sets status and achievedAt', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    store.getState().achieveGoal('g1');
    const goal = store.getState().goalsDraft[0];
    expect(goal.status).toBe('achieved');
    expect(goal.achievedAt).not.toBeNull();
  });

  it('linkRequirementToGoal is idempotent', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    store.getState().linkRequirementToGoal('g1', 'r1');
    store.getState().linkRequirementToGoal('g1', 'r1');
    expect(store.getState().goalRequirementLinksDraft.length).toBe(1);
  });

  it('recordGoalRun stores the prompt artifact and flips goal to in_progress', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ status: 'active' }));
    store.getState().recordGoalRun(makeRun({ prompt: 'Goal prompt v1' }));
    expect(store.getState().goalRunsDraft[0].prompt).toBe('Goal prompt v1');
    expect(store.getState().goalsDraft[0].status).toBe('in_progress');
  });

  it('completeGoalRun sets outcome, summary and finishedAt', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    store.getState().recordGoalRun(makeRun());
    store.getState().completeGoalRun('run1', 'completed', 'All done');
    const run = store.getState().goalRunsDraft[0];
    expect(run.outcome).toBe('completed');
    expect(run.summary).toBe('All done');
    expect(run.finishedAt).not.toBeNull();
  });

  it('discardGoalChanges restores persisted state', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    store.getState().discardGoalChanges();
    expect(store.getState().goalsDraft).toEqual([]);
    expect(store.getState().goalsDirty).toBe(false);
  });
});

describe('goalsSlice persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadGoals initializes db and hydrates draft when clean', async () => {
    mockGoalsLoad.mockResolvedValueOnce({
      goals: [makeGoal()],
      goalRuns: [makeRun()],
      requirementLinks: [],
    });
    const store = createTestStore();
    await store.getState().loadGoals('/project');
    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(store.getState().goals.length).toBe(1);
    expect(store.getState().goalsDraft.length).toBe(1);
    expect(store.getState().goalRuns.length).toBe(1);
  });

  it('loadGoals keeps dirty local edits but adopts rows created by MCP agents', async () => {
    const store = createTestStore();
    await store.getState().loadGoals('/project');
    store.getState().addGoal(makeGoal({ id: 'local' }));
    mockGoalsLoad.mockResolvedValueOnce({
      goals: [makeGoal({ id: 'mcp-created' })],
      goalRuns: [makeRun({ id: 'mcp-run', goalId: 'mcp-created' })],
      requirementLinks: [],
    });
    await store.getState().loadGoals('/project');
    // Local unsaved edit survives AND the MCP-created rows become visible
    expect(store.getState().goalsDraft.map((g) => g.id)).toEqual(['local', 'mcp-created']);
    expect(store.getState().goalRunsDraft.map((r) => r.id)).toEqual(['mcp-run']);
    expect(store.getState().goals.map((g) => g.id)).toEqual(['mcp-created']);
  });

  it('saveGoals persists draft and clears dirty flag', async () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    await store.getState().saveGoals('/project');
    expect(mockGoalsSave).toHaveBeenCalledTimes(1);
    expect(store.getState().goalsDirty).toBe(false);
    expect(store.getState().goals.length).toBe(1);
  });

  it('saveGoals sends row-level deletions instead of replace-all', async () => {
    mockGoalsLoad.mockResolvedValueOnce({
      goals: [makeGoal({ id: 'keep' }), makeGoal({ id: 'doomed' })],
      goalRuns: [],
      requirementLinks: [],
    });
    const store = createTestStore();
    await store.getState().loadGoals('/project');
    store.getState().deleteGoal('doomed');
    await store.getState().saveGoals('/project');

    const payload = mockGoalsSave.mock.calls[0][1] as {
      goals: { id: string }[];
      deletedGoalIds: string[];
    };
    expect(payload.goals.map((g) => g.id)).toEqual(['keep']);
    expect(payload.deletedGoalIds).toEqual(['doomed']);
  });

  it('saveGoals adopts rows MCP agents wrote concurrently', async () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ id: 'local' }));
    // The post-save reload returns the saved row plus an MCP-created one
    mockGoalsLoad.mockResolvedValueOnce({
      goals: [makeGoal({ id: 'local' }), makeGoal({ id: 'mcp-subgoal', parentId: 'local' })],
      goalRuns: [],
      requirementLinks: [],
    });
    await store.getState().saveGoals('/project');

    expect(store.getState().goalsDraft.map((g) => g.id)).toEqual(['local', 'mcp-subgoal']);
    expect(store.getState().goals.map((g) => g.id)).toEqual(['local', 'mcp-subgoal']);
    expect(store.getState().goalsDirty).toBe(false);
  });

  it('clearGoals wipes everything', async () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    await store.getState().clearGoals('/project');
    expect(mockGoalsClear).toHaveBeenCalledTimes(1);
    expect(store.getState().goalsDraft).toEqual([]);
    expect(store.getState().goals).toEqual([]);
  });
});

describe('getGoalWorkflowStage', () => {
  const noReqs: PmRequirement[] = [];

  it('is "define" while the goal has no success criteria', () => {
    const goal = makeGoal({ successCriteria: '' });
    const step = getGoalWorkflowStage([goal], [], noReqs, [], goal.id);
    expect(step.stage).toBe('define');
    expect(step.index).toBe(1);
  });

  it('is "attach" when criteria exist but nothing is attached', () => {
    const goal = makeGoal();
    const step = getGoalWorkflowStage([goal], [], noReqs, [], goal.id);
    expect(step.stage).toBe('attach');
    expect(step.index).toBe(2);
  });

  it('is "execute" while attached tickets are not all done', () => {
    const goal = makeGoal();
    const tickets = [makeTicket({ goalId: goal.id, status: 'open' })];
    const step = getGoalWorkflowStage([goal], tickets, noReqs, [], goal.id);
    expect(step.stage).toBe('execute');
    expect(step.index).toBe(3);
  });

  it('counts tickets on descendant goals as attached work', () => {
    const parent = makeGoal({ id: 'p' });
    const child = makeGoal({ id: 'c', parentId: 'p' });
    const tickets = [makeTicket({ goalId: 'c', status: 'open' })];
    const step = getGoalWorkflowStage([parent, child], tickets, noReqs, [], 'p');
    expect(step.stage).toBe('execute');
  });

  it('is "done" once the satisfaction check passes', () => {
    const goal = makeGoal();
    const tickets = [makeTicket({ goalId: goal.id, status: 'done' })];
    const step = getGoalWorkflowStage([goal], tickets, noReqs, [], goal.id);
    expect(step.stage).toBe('done');
    expect(step.index).toBe(4);
  });

  it('is "done" for an achieved goal regardless of attachments', () => {
    const goal = makeGoal({ status: 'achieved', successCriteria: '' });
    const step = getGoalWorkflowStage([goal], [], noReqs, [], goal.id);
    expect(step.stage).toBe('done');
  });

  it('stays "execute" when tickets are done but a linked requirement is unverified', () => {
    const goal = makeGoal();
    const req = makeRequirement({ status: 'active' });
    const tickets = [makeTicket({ goalId: goal.id, status: 'done' })];
    const links = [
      { id: 'l1', goalId: goal.id, requirementId: req.id, createdAt: '2026-01-01 00:00:00' },
    ];
    const step = getGoalWorkflowStage([goal], tickets, [req], links, goal.id);
    expect(step.stage).toBe('execute');
  });
});

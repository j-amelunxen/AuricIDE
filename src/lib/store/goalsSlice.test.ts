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
  planGoalMove,
} from './goalsSlice';
import { createPmSlice, type PmSlice } from './pmSlice';
import { VERIFIED_EVIDENCE_KINDS, isVerifiedEvidence } from '../pm/enums';
import type { GoalsState, PmGoal, PmGoalRun } from '../tauri/goals';
import type { PmTicket } from '../tauri/pm';
import type { PmRequirement } from '../tauri/requirements';

const mockGoalsLoad = vi.fn<(...args: unknown[]) => Promise<GoalsState>>(() =>
  Promise.resolve({ goals: [], goalRuns: [], requirementLinks: [], stations: [] })
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

/** Goals plus PM — tickets carry their goal link on their own side. */
function createGoalsPmStore() {
  return create<GoalsSlice & PmSlice>()((...a) => ({
    ...createGoalsSlice(...a),
    ...createPmSlice(...a),
  }));
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

  it('plans reparenting a goal inside another goal', () => {
    const moveGoals = [
      makeGoal({ id: 'root', sortOrder: 0 }),
      makeGoal({ id: 'old-parent', parentId: 'root', sortOrder: 0 }),
      makeGoal({ id: 'dragged', parentId: 'old-parent', sortOrder: 0 }),
    ];

    expect(planGoalMove(moveGoals, 'dragged', 'root', 'inside')).toContainEqual({
      id: 'dragged',
      parentId: 'root',
      sortOrder: 1,
    });
  });

  it('plans sibling insertion and rejects cyclic moves', () => {
    const moveGoals = [
      makeGoal({ id: 'root' }),
      makeGoal({ id: 'first', parentId: 'root', sortOrder: 0 }),
      makeGoal({ id: 'second', parentId: 'root', sortOrder: 1 }),
      makeGoal({ id: 'child', parentId: 'first', sortOrder: 0 }),
    ];

    expect(planGoalMove(moveGoals, 'second', 'first', 'before')).toContainEqual({
      id: 'second',
      parentId: 'root',
      sortOrder: 0,
    });
    expect(planGoalMove(moveGoals, 'first', 'child', 'inside')).toEqual([]);
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

    const result = getGoalSatisfaction(goals, tickets, requirements, links, [], 'g1');
    expect(result.satisfied).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('getGoalSatisfaction refuses vacuous satisfaction for empty goals', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const result = getGoalSatisfaction(goals, [], [], [], [], 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers).toEqual([
      'This goal has no attached tickets, linked requirements, child goals, or goal-line stations. Add work before running the conductor.',
    ]);
  });

  it('getGoalSatisfaction lists precise blockers', () => {
    const goals = [
      makeGoal({ id: 'g1' }),
      makeGoal({ id: 'g2', parentId: 'g1', status: 'active', name: 'Sub goal' }),
    ];
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'open', name: 'Open work' })];
    const requirements = [makeRequirement({ id: 'r1', status: 'active', reqId: 'REQ-01' })];
    const links = [{ id: 'l1', goalId: 'g1', requirementId: 'r1', createdAt: '' }];

    const result = getGoalSatisfaction(goals, tickets, requirements, links, [], 'g1');
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

  it('deleteGoal clears goalId on tickets across the whole deleted subtree', () => {
    const store = createGoalsPmStore();
    store.getState().addGoal(makeGoal({ id: 'g1' }));
    store.getState().addGoal(makeGoal({ id: 'g2', parentId: 'g1' }));
    store.setState({
      pmDraftTickets: [
        makeTicket({ id: 't-root', goalId: 'g1' }),
        makeTicket({ id: 't-child', goalId: 'g2' }),
      ],
      pmDirty: false,
    });

    store.getState().deleteGoal('g1');

    const tickets = store.getState().pmDraftTickets;
    expect(tickets.find((t) => t.id === 't-root')?.goalId).toBeNull();
    expect(tickets.find((t) => t.id === 't-child')?.goalId).toBeNull();
    expect(store.getState().pmDirty).toBe(true);
  });

  it('deleteGoal leaves tickets of untouched goals linked', () => {
    const store = createGoalsPmStore();
    store.getState().addGoal(makeGoal({ id: 'g1' }));
    store.getState().addGoal(makeGoal({ id: 'g3' }));
    store.setState({
      pmDraftTickets: [
        makeTicket({ id: 't-doomed', goalId: 'g1' }),
        makeTicket({ id: 't-other', goalId: 'g3' }),
        makeTicket({ id: 't-loose', goalId: null }),
      ],
      pmDirty: false,
    });

    store.getState().deleteGoal('g1');

    const tickets = store.getState().pmDraftTickets;
    expect(tickets.find((t) => t.id === 't-other')?.goalId).toBe('g3');
    expect(tickets.find((t) => t.id === 't-loose')?.goalId).toBeNull();
    expect(tickets).toHaveLength(3);
  });

  it('deleteGoal without the PM slice still deletes the goal', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ id: 'g1' }));
    store.getState().deleteGoal('g1');
    expect(store.getState().goalsDraft).toHaveLength(0);
  });

  it('resetGoalLine removes only direct stations and makes an active goal draft again', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ id: 'g1', status: 'active' }));
    store.getState().addGoal(makeGoal({ id: 'child', parentId: 'g1' }));
    const base = {
      name: 'Step',
      kind: 'normal' as const,
      status: 'planned' as const,
      evidenceKind: 'claim' as const,
      predicate: { type: 'undefined' as const },
      evidenceNote: '',
      ticketId: null,
      lane: 0,
      sortOrder: 0,
      lastCheckedAt: null,
      doneAt: null,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    };
    store.getState().addStation({ ...base, id: 'direct', goalId: 'g1' });
    store.getState().addStation({ ...base, id: 'nested', goalId: 'child' });

    store.getState().resetGoalLine('g1');

    expect(store.getState().goalStationsDraft.map((station) => station.id)).toEqual(['nested']);
    expect(store.getState().goalsDraft.find((goal) => goal.id === 'g1')?.status).toBe('draft');
    expect(store.getState().goalsDraft.find((goal) => goal.id === 'child')).toBeTruthy();
  });

  it('resetGoalLine preserves achieved and archived goal statuses', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal({ id: 'done', status: 'achieved' }));
    store.getState().addGoal(makeGoal({ id: 'old', status: 'archived' }));
    store.getState().resetGoalLine('done');
    store.getState().resetGoalLine('old');
    expect(store.getState().goalsDraft.map((goal) => goal.status)).toEqual([
      'achieved',
      'archived',
    ]);
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

describe('goalsSlice load status', () => {
  // A scheduled conductor run opens a project and then waits for
  // `!goalsLoading` before it starts (`launchScheduledConductor` in
  // src/lib/conductor/scheduledRun.ts). `handleOpenRecent` kicks the load off
  // without awaiting it, so the flag has to be up before that call returns —
  // one microtask later and the wait passes on the *previous* project's
  // finished state, starting the run against goals that have not arrived.
  it('raises goalsLoading synchronously, before the read is even reached', () => {
    const store = createTestStore();
    mockGoalsLoad.mockImplementationOnce(() => new Promise(() => {}));

    void store.getState().loadGoals('/repo');

    expect(store.getState().goalsLoading).toBe(true);
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
      stations: [],
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
      stations: [],
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
      stations: [],
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
      stations: [],
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
    const step = getGoalWorkflowStage([goal], [], noReqs, [], [], goal.id);
    expect(step.stage).toBe('define');
    expect(step.index).toBe(1);
  });

  it('is "attach" when criteria exist but nothing is attached', () => {
    const goal = makeGoal();
    const step = getGoalWorkflowStage([goal], [], noReqs, [], [], goal.id);
    expect(step.stage).toBe('attach');
    expect(step.index).toBe(2);
  });

  it('is "execute" while attached tickets are not all done', () => {
    const goal = makeGoal();
    const tickets = [makeTicket({ goalId: goal.id, status: 'open' })];
    const step = getGoalWorkflowStage([goal], tickets, noReqs, [], [], goal.id);
    expect(step.stage).toBe('execute');
    expect(step.index).toBe(3);
  });

  it('keeps a saved station-only line in planning until executable tickets exist', () => {
    const goal = makeGoal();
    const stations = [
      {
        id: 's1',
        goalId: goal.id,
        name: 'Implement the workflow',
        kind: 'normal' as const,
        status: 'planned' as const,
        evidenceKind: 'claim' as const,
        predicate: { type: 'undefined' as const },
        evidenceNote: '',
        ticketId: null,
        lane: 0,
        sortOrder: 0,
        lastCheckedAt: null,
        doneAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    const step = getGoalWorkflowStage([goal], [], noReqs, [], stations, goal.id);

    expect(step.stage).toBe('attach');
    expect(step.index).toBe(2);
    expect(step.hint).toMatch(/plan is saved.*create tickets/i);
  });

  it('does not skip to achieved when checkpoints pass without executable tickets', () => {
    const goal = makeGoal();
    const station = {
      id: 's1',
      goalId: goal.id,
      name: 'Checkpoint',
      kind: 'human' as const,
      status: 'done' as const,
      evidenceKind: 'human' as const,
      predicate: { type: 'human' as const },
      evidenceNote: '',
      ticketId: null,
      lane: 0,
      sortOrder: 0,
      lastCheckedAt: '',
      doneAt: '',
      createdAt: '',
      updatedAt: '',
    };

    expect(getGoalWorkflowStage([goal], [], noReqs, [], [station], goal.id).stage).toBe('attach');
  });

  it('counts tickets on descendant goals as attached work', () => {
    const parent = makeGoal({ id: 'p' });
    const child = makeGoal({ id: 'c', parentId: 'p' });
    const tickets = [makeTicket({ goalId: 'c', status: 'open' })];
    const step = getGoalWorkflowStage([parent, child], tickets, noReqs, [], [], 'p');
    expect(step.stage).toBe('execute');
  });

  it('is "done" once the satisfaction check passes', () => {
    const goal = makeGoal();
    const tickets = [makeTicket({ goalId: goal.id, status: 'done' })];
    const step = getGoalWorkflowStage([goal], tickets, noReqs, [], [], goal.id);
    expect(step.stage).toBe('done');
    expect(step.index).toBe(4);
  });

  it('is "done" for an achieved goal regardless of attachments', () => {
    const goal = makeGoal({ status: 'achieved', successCriteria: '' });
    const step = getGoalWorkflowStage([goal], [], noReqs, [], [], goal.id);
    expect(step.stage).toBe('done');
  });

  it('stays "execute" when tickets are done but a linked requirement is unverified', () => {
    const goal = makeGoal();
    const req = makeRequirement({ status: 'active' });
    const tickets = [makeTicket({ goalId: goal.id, status: 'done' })];
    const links = [
      { id: 'l1', goalId: goal.id, requirementId: req.id, createdAt: '2026-01-01 00:00:00' },
    ];
    const step = getGoalWorkflowStage([goal], tickets, [req], links, [], goal.id);
    expect(step.stage).toBe('execute');
  });
});

describe('goal lines view state', () => {
  it('is closed by default and toggles via its setter', () => {
    const store = createTestStore();
    expect(store.getState().goalLinesOpen).toBe(false);
    store.getState().setGoalLinesOpen(true);
    expect(store.getState().goalLinesOpen).toBe(true);
    store.getState().setGoalLinesOpen(false);
    expect(store.getState().goalLinesOpen).toBe(false);
  });

  it('remembers when Goal Lines was opened from Goals, and forgets a rail open', () => {
    const store = createTestStore();
    store.getState().setGoalLinesOpen(true, { fromGoals: true });
    expect(store.getState().goalLinesReturnToGoals).toBe(true);
    store.getState().setGoalLinesOpen(false);
    expect(store.getState().goalLinesReturnToGoals).toBe(false);

    store.getState().setGoalLinesOpen(true);
    expect(store.getState().goalLinesReturnToGoals).toBe(false);
  });
});

describe('goal stations in the draft double-buffer', () => {
  const stationFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    goalId: 'g1',
    name: 'A step',
    kind: 'normal' as const,
    status: 'planned' as const,
    evidenceKind: 'claim' as const,
    predicate: { type: 'undefined' as const },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  });

  it('quickAddHumanStation appends a human step and marks dirty', () => {
    const store = createTestStore();
    store.getState().quickAddHumanStation('g1', 'Call the customer');
    const drafts = store.getState().goalStationsDraft;
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe('Call the customer');
    expect(drafts[0].kind).toBe('human');
    expect(drafts[0].predicate).toEqual({ type: 'human' });
    expect(store.getState().goalsDirty).toBe(true);
    expect(store.getState().goalStations).toHaveLength(0);
  });

  it('tickHumanStation stamps done with human evidence', () => {
    const store = createTestStore();
    store.getState().addStation(stationFixture({ kind: 'human', evidenceKind: 'human' }));
    store.getState().tickHumanStation('s1', 'spoke to them');
    const station = store.getState().goalStationsDraft[0];
    expect(station.status).toBe('done');
    expect(station.evidenceKind).toBe('human');
    expect(station.evidenceNote).toBe('spoke to them');
    expect(station.doneAt).not.toBeNull();
  });

  it('moveStationTo clamps so pending work never precedes done work', () => {
    const store = createTestStore();
    store.getState().addStation(stationFixture({ id: 'd1', status: 'done', sortOrder: 0 }));
    store.getState().addStation(stationFixture({ id: 'p1', sortOrder: 1 }));
    store.getState().addStation(stationFixture({ id: 'p2', sortOrder: 2 }));
    store.getState().moveStationTo('g1', 'p2', 0);
    const order = [...store.getState().goalStationsDraft]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => s.id);
    expect(order).toEqual(['d1', 'p2', 'p1']);
  });

  it('deleteGoal cascades to the goal stations in the draft', () => {
    const store = createTestStore();
    store.getState().addGoal(makeGoal());
    store.getState().addStation(stationFixture());
    store.getState().deleteGoal('g1');
    expect(store.getState().goalStationsDraft).toHaveLength(0);
  });

  it('loadGoals adopts MCP-written stations into a dirty draft', async () => {
    const store = createTestStore();
    // Make the draft dirty for the current project first.
    await store.getState().loadGoals('/p');
    store.getState().addStation(stationFixture({ id: 'local' }));
    mockGoalsLoad.mockResolvedValueOnce({
      goals: [],
      goalRuns: [],
      requirementLinks: [],
      stations: [stationFixture({ id: 'from-mcp' }) as never],
    });
    await store.getState().loadGoals('/p');
    const ids = store.getState().goalStationsDraft.map((s) => s.id);
    expect(ids).toContain('local');
    expect(ids).toContain('from-mcp');
  });

  it('saveGoals reports locally deleted stations and merges concurrent rows', async () => {
    const store = createTestStore();
    mockGoalsLoad.mockResolvedValueOnce({
      goals: [],
      goalRuns: [],
      requirementLinks: [],
      stations: [stationFixture({ id: 'persisted' }) as never],
    });
    await store.getState().loadGoals('/p');
    store.getState().deleteStation('persisted');
    await store.getState().saveGoals('/p');
    const payload = mockGoalsSave.mock.calls.at(-1)![1] as {
      deletedStationIds: string[];
    };
    expect(payload.deletedStationIds).toEqual(['persisted']);
    expect(store.getState().goalsDirty).toBe(false);
  });
});

// The LOCKSTEP FIXTURE: identical scenario asserted on the SQL side in
// src/mcp/__tests__/goals.test.ts. If either implementation changes without
// the other, one of the two tests fails.
describe('lockstep: an open human station blocks satisfaction', () => {
  it('even when all tickets are done', () => {
    const goal = makeGoal({ id: 'g1', name: 'Ship the offer' });
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })];
    const stations = [
      {
        id: 's1',
        goalId: 'g1',
        name: 'Call the customer',
        kind: 'human' as const,
        status: 'planned' as const,
        evidenceKind: 'human' as const,
        predicate: { type: 'human' as const },
        evidenceNote: '',
        ticketId: null,
        lane: 0,
        sortOrder: 0,
        lastCheckedAt: null,
        doneAt: null,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      },
    ];
    const result = getGoalSatisfaction([goal], tickets, [], [], stations, 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers).toContain('Station "Call the customer" is planned');

    // Ticked off → satisfied: stations alone also defeat the vacuous-goal rule.
    const done = [{ ...stations[0], status: 'done' as const }];
    expect(getGoalSatisfaction([goal], tickets, [], [], done, 'g1').satisfied).toBe(true);
  });
});

// LOCKSTEP FIXTURE (twin in src/mcp/__tests__/goals.test.ts): a station an
// agent only CLAIMED done must not satisfy — the judge has to promote it.
describe('lockstep: a claimed station blocks satisfaction until verified', () => {
  const claimStation = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    goalId: 'g1',
    name: 'Build the parser',
    kind: 'normal' as const,
    status: 'done' as const,
    evidenceKind: 'claim' as const,
    predicate: { type: 'undefined' as const },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: '2026-01-01 00:00:00',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  });

  it('a done+claim station blocks with an unverified-claim blocker', () => {
    const goal = makeGoal({ id: 'g1', name: 'Ship it' });
    const result = getGoalSatisfaction([goal], [], [], [], [claimStation()], 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers).toContain('Station "Build the parser": unverified claim');
  });

  it('the same station satisfies once verified (judged / proof / human)', () => {
    const goal = makeGoal({ id: 'g1', name: 'Ship it' });
    for (const evidenceKind of ['judged', 'proof', 'human'] as const) {
      const result = getGoalSatisfaction(
        [goal],
        [],
        [],
        [],
        [claimStation({ evidenceKind })],
        'g1'
      );
      expect(result.satisfied).toBe(true);
    }
  });
});

describe('a ticket in review blocks satisfaction', () => {
  it('an in_review ticket is not done, so the goal is not satisfied', () => {
    const goal = makeGoal({ id: 'g1', name: 'Ship it' });
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'in_review' })];
    const result = getGoalSatisfaction([goal], tickets, [], [], [], 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers.some((b) => b.includes('in_review'))).toBe(true);
  });

  it('a to_test ticket is not done, so the goal is not satisfied', () => {
    const goal = makeGoal({ id: 'g1', name: 'Ship it' });
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'to_test' })];
    const result = getGoalSatisfaction([goal], tickets, [], [], [], 'g1');
    expect(result.satisfied).toBe(false);
    expect(result.blockers.some((b) => b.includes('to_test'))).toBe(true);
  });

  it('a discarded ticket is cancelled work and does not block the goal', () => {
    const goal = makeGoal({ id: 'g1', name: 'Ship it' });
    const tickets = [makeTicket({ id: 't1', goalId: 'g1', status: 'discarded' })];
    const result = getGoalSatisfaction([goal], tickets, [], [], [], 'g1');
    expect(result.satisfied).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});

describe('VERIFIED_EVIDENCE_KINDS — the shared satisfaction rule', () => {
  it('excludes claim, so a bare claim can never satisfy', () => {
    expect(VERIFIED_EVIDENCE_KINDS).not.toContain('claim');
    expect(isVerifiedEvidence('claim')).toBe(false);
    expect(isVerifiedEvidence('judged')).toBe(true);
    expect(isVerifiedEvidence('proof')).toBe(true);
    expect(isVerifiedEvidence('human')).toBe(true);
  });
});

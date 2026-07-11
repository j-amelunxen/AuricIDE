import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import { createGoalsSlice } from './goalsSlice';
import { createPmSlice } from './pmSlice';
import {
  createConductorSlice,
  getUnblockedOpenTickets,
  modelForPower,
  buildConductorPrompt,
} from './conductorSlice';
import type { StoreState } from './index';
import type { PmDependency, PmTicket } from '../tauri/pm';
import type { PmGoal } from '../tauri/goals';
import { spawnAgent } from '../tauri/agents';

let agentCounter = 0;

vi.mock('../tauri/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawnAgent: vi.fn(async (config: any) => ({
    id: `mock-agent-${++agentCounter}`,
    name: config.name,
    model: config.model,
    provider: config.provider || 'claude',
    status: 'running' as const,
    currentTask: config.task,
    startedAt: 1000,
    spawnedByTicketId: config.spawnedByTicketId,
    spawnedByGoalId: config.spawnedByGoalId,
  })),
  killAgent: vi.fn(async () => undefined),
  listAgents: vi.fn(async () => []),
}));

vi.mock('../tauri/goals', () => ({
  goalsLoad: vi.fn(async () => ({ goals: [], goalRuns: [], requirementLinks: [] })),
  goalsSave: vi.fn(async () => undefined),
  goalsClear: vi.fn(async () => undefined),
}));

vi.mock('../tauri/pm', () => ({
  pmLoad: vi.fn(async () => ({ epics: [], tickets: [], testCases: [], dependencies: [] })),
  pmSave: vi.fn(async () => undefined),
  pmClear: vi.fn(async () => undefined),
}));

vi.mock('../tauri/db', () => ({
  initProjectDb: vi.fn(async () => undefined),
}));

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Ticket',
    description: 'Body',
    status: 'open',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Goal',
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('conductor pure helpers', () => {
  it('getUnblockedOpenTickets returns open tickets sorted by priority then sortOrder', () => {
    const tickets = [
      makeTicket({ id: 'a', priority: 'low', sortOrder: 0 }),
      makeTicket({ id: 'b', priority: 'critical', sortOrder: 5 }),
      makeTicket({ id: 'c', priority: 'critical', sortOrder: 1 }),
      makeTicket({ id: 'd', status: 'done' }),
    ];
    const result = getUnblockedOpenTickets(tickets, [], tickets);
    expect(result.map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('getUnblockedOpenTickets excludes tickets with unfinished dependencies', () => {
    const blocker = makeTicket({ id: 'blocker', status: 'in_progress' });
    const blocked = makeTicket({ id: 'blocked' });
    const deps: PmDependency[] = [
      {
        id: 'd1',
        sourceType: 'ticket',
        sourceId: 'blocked',
        targetType: 'ticket',
        targetId: 'blocker',
      },
    ];
    const all = [blocker, blocked];
    expect(getUnblockedOpenTickets(all, deps, all).map((t) => t.id)).toEqual([]);
  });

  it('getUnblockedOpenTickets allows tickets whose dependencies are done', () => {
    const blocker = makeTicket({ id: 'blocker', status: 'done' });
    const blocked = makeTicket({ id: 'blocked' });
    const deps: PmDependency[] = [
      {
        id: 'd1',
        sourceType: 'ticket',
        sourceId: 'blocked',
        targetType: 'ticket',
        targetId: 'blocker',
      },
    ];
    const all = [blocker, blocked];
    expect(getUnblockedOpenTickets(all, deps, all).map((t) => t.id)).toEqual(['blocked']);
  });

  it('modelForPower maps capability tiers to models', () => {
    expect(modelForPower('low')).toBe('haiku');
    expect(modelForPower('medium')).toBe('sonnet');
    expect(modelForPower('high')).toBe('opus');
    expect(modelForPower(undefined)).toBe('sonnet');
  });

  it('buildConductorPrompt includes ticket, goal context, and acceptance tests', () => {
    const ticket = makeTicket({
      name: 'Implement login',
      description: 'Add login form',
      context: [{ id: 'c1', type: 'snippet', value: 'const x = 1;' }],
    });
    const goal = makeGoal({ name: 'Ship auth', successCriteria: '- users can log in' });
    const prompt = buildConductorPrompt(ticket, goal, [
      {
        id: 'tc1',
        ticketId: 't1',
        title: 'login works',
        body: 'try to log in',
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    expect(prompt).toContain('Implement login');
    expect(prompt).toContain('Add login form');
    expect(prompt).toContain('Ship auth');
    expect(prompt).toContain('users can log in');
    expect(prompt).toContain('login works');
    expect(prompt).toContain('const x = 1;');
  });
});

describe('conductorSlice', () => {
  let store: StoreApi<StoreState>;

  beforeEach(() => {
    vi.clearAllMocks();
    agentCounter = 0;
    // @ts-expect-error - Partial store for testing
    store = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createGoalsSlice(...a),
      ...createPmSlice(...a),
      ...createConductorSlice(...a),
    }));
  });

  it('spawns agents for unblocked tickets up to maxConcurrent, highest priority first', async () => {
    store.setState({
      pmDraftTickets: [
        makeTicket({ id: 't1', priority: 'normal' }),
        makeTicket({ id: 't2', priority: 'critical' }),
        makeTicket({ id: 't3', priority: 'low' }),
      ],
      conductorMaxConcurrent: 2,
    });

    store.getState().startConductor(null);
    await store.getState().conductorTick();

    const state = store.getState();
    expect(Object.keys(state.conductorAssignments).sort()).toEqual(['t1', 't2']);
    expect(state.agents).toHaveLength(2);
    // Spawned tickets move to in_progress
    expect(state.pmDraftTickets.find((t) => t.id === 't2')?.status).toBe('in_progress');
    expect(state.pmDraftTickets.find((t) => t.id === 't3')?.status).toBe('open');
    // Decision log records the spawns
    expect(state.conductorDecisions.filter((d) => d.action === 'spawn')).toHaveLength(2);
  });

  it('stopConductor kills all running agents (stopping actually stops)', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' }), makeTicket({ id: 't2' })],
      conductorMaxConcurrent: 2,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    expect(store.getState().agents).toHaveLength(2);

    store.getState().stopConductor();
    await new Promise((r) => setTimeout(r, 0)); // flush the async kills

    expect(store.getState().conductorRunning).toBe(false);
    expect(store.getState().agents).toHaveLength(0);
    expect(store.getState().conductorAssignments).toEqual({});
  });

  it('uses the conductor provider/model override when set', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
      conductorProviderId: 'gemini',
      conductorModel: 'opus',
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    const agent = store.getState().agents[0];
    expect(agent.model).toBe('opus');
    expect(agent.provider).toBe('gemini');
  });

  it('omits permissionMode so the provider-configured default decides', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    const mockSpawn = vi.mocked(spawnAgent);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    // No hardcoded mode: the backend resolves the defaultPermissionMode
    // from the provider's dynamic config (dynamic-providers/*.json).
    expect(mockSpawn.mock.calls[0][0].permissionMode).toBeUndefined();
  });

  it('does not spawn when conductor is stopped', async () => {
    store.setState({ pmDraftTickets: [makeTicket()] });
    await store.getState().conductorTick();
    expect(store.getState().agents).toHaveLength(0);
  });

  it('respects dependency blocking', async () => {
    store.setState({
      pmDraftTickets: [
        makeTicket({ id: 'blocker', status: 'in_progress' }),
        makeTicket({ id: 'blocked' }),
      ],
      pmDraftDependencies: [
        {
          id: 'd1',
          sourceType: 'ticket',
          sourceId: 'blocked',
          targetType: 'ticket',
          targetId: 'blocker',
        },
      ],
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    expect(store.getState().agents).toHaveLength(0);
  });

  it('routes supervised tickets into the approval queue instead of spawning', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1', needsHumanSupervision: true })],
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    expect(store.getState().agents).toHaveLength(0);
    expect(store.getState().conductorPendingApprovals).toEqual(['t1']);

    await store.getState().approveConductorTicket('t1');
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().conductorPendingApprovals).toEqual([]);
  });

  it('scopes to a goal subtree and records goal runs with source conductor', async () => {
    store.setState({
      goalsDraft: [makeGoal({ id: 'g1' }), makeGoal({ id: 'g2', parentId: 'g1' })],
      pmDraftTickets: [makeTicket({ id: 'in-goal', goalId: 'g2' }), makeTicket({ id: 'outside' })],
    });
    store.getState().startConductor('g1');
    await store.getState().conductorTick();

    expect(Object.keys(store.getState().conductorAssignments)).toEqual(['in-goal']);
    const runs = store.getState().goalRunsDraft;
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe('conductor');
    expect(runs[0].ticketId).toBe('in-goal');
  });

  it('completes the ticket and continues the loop when an agent finishes', async () => {
    store.setState({
      pmDraftTickets: [
        makeTicket({ id: 't1', priority: 'critical' }),
        makeTicket({ id: 't2', priority: 'low' }),
      ],
      conductorMaxConcurrent: 1,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
    const agentId = store.getState().conductorAssignments['t1'];

    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    // allow the follow-up async tick to run
    await vi.waitFor(() => {
      expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('done');
      expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t2']);
    });
  });

  it('requeues a failed ticket once, then gives up', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    // First failure: requeued and respawned by the follow-up tick
    store
      .getState()
      .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'error');
    await vi.waitFor(() => {
      expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
    });

    // Second failure: permanently skipped
    store
      .getState()
      .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'error');
    await vi.waitFor(() => {
      expect(Object.keys(store.getState().conductorAssignments)).toEqual([]);
    });
    expect(store.getState().pmDraftTickets[0].status).toBe('open');
    expect(store.getState().conductorFailedTickets['t1']).toBe(2);
  });

  it('achieves the goal and stops when everything in scope is done and satisfied', async () => {
    store.setState({
      goalsDraft: [makeGoal({ id: 'g1', status: 'in_progress' })],
      pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
    });
    store.getState().startConductor('g1');
    await store.getState().conductorTick();

    expect(store.getState().goalsDraft[0].status).toBe('achieved');
    expect(store.getState().conductorRunning).toBe(false);
    expect(store.getState().conductorDecisions.some((d) => d.action === 'goal_achieved')).toBe(
      true
    );
  });

  it('stops with blockers when scope is exhausted but goal not satisfiable', async () => {
    store.setState({
      goalsDraft: [
        makeGoal({ id: 'g1', status: 'in_progress' }),
        makeGoal({ id: 'g2', parentId: 'g1', status: 'active' }),
      ],
      pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
    });
    store.getState().startConductor('g1');
    await store.getState().conductorTick();

    expect(store.getState().goalsDraft[0].status).not.toBe('achieved');
    expect(store.getState().conductorRunning).toBe(false);
    const stopDecision = store.getState().conductorDecisions.find((d) => d.action === 'stop');
    expect(stopDecision?.detail).toContain('Sub-goal');
  });

  it('refuses to auto-achieve an empty goal (vacuous satisfaction guard)', async () => {
    store.setState({
      goalsDraft: [makeGoal({ id: 'g1', status: 'in_progress' })],
      pmDraftTickets: [],
    });
    store.getState().startConductor('g1');
    await store.getState().conductorTick();

    expect(store.getState().goalsDraft[0].status).not.toBe('achieved');
    expect(store.getState().conductorRunning).toBe(false);
    const stopDecision = store.getState().conductorDecisions.find((d) => d.action === 'stop');
    expect(stopDecision?.detail).toContain('nothing to verify');
  });

  it('terminates all-tickets mode when no work is left', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1', status: 'done' })],
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    expect(store.getState().conductorRunning).toBe(false);
    const stopDecision = store.getState().conductorDecisions.find((d) => d.action === 'stop');
    expect(stopDecision?.detail).toContain('All unblocked tickets processed');
  });

  it('reverts the ticket and counts an attempt when the spawn fails', async () => {
    const { spawnAgent } = await import('../tauri/agents');
    (spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('CLI missing'));

    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    // Spawn failed: no assignment left behind, ticket still open, attempt counted
    expect(store.getState().conductorAssignments).toEqual({});
    expect(store.getState().pmDraftTickets[0].status).toBe('open');
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
    expect(store.getState().conductorDecisions.some((d) => d.action === 'fail')).toBe(true);

    // Next tick succeeds (mock back to normal) — ticket is retried
    await store.getState().conductorTick();
    expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
    expect(store.getState().pmDraftTickets[0].status).toBe('in_progress');
  });

  it('reopens and excludes the ticket when a conductor agent is killed', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    const agentId = store.getState().conductorAssignments['t1'];
    expect(store.getState().pmDraftTickets[0].status).toBe('in_progress');

    await store.getState().killRunningAgent(agentId);

    await vi.waitFor(() => {
      expect(store.getState().pmDraftTickets[0].status).toBe('open');
    });
    // NOT marked done, excluded from this conductor run
    expect(store.getState().conductorAssignments).toEqual({});
    expect(store.getState().conductorFailedTickets['t1']).toBeGreaterThanOrEqual(2);
    // The goal run for the kill is recorded as killed, and the decision agrees
    const killDecision = store
      .getState()
      .conductorDecisions.find((d) => d.detail.includes('killed by user'));
    expect(killDecision).toBeTruthy();
  });
});

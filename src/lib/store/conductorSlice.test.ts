import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import { createGoalsSlice } from './goalsSlice';
import { createPmSlice } from './pmSlice';
import {
  createConductorSlice,
  getConductorPreflight,
  getUnblockedOpenTickets,
  modelForPower,
  buildConductorPrompt,
  MAX_TICKET_ATTEMPTS,
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
  renameAgent: vi.fn(async () => undefined),
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

const mockNotifyConductor = vi.fn();

vi.mock('../ide/conductorNotifications', () => ({
  notifyConductor: (...args: unknown[]) => mockNotifyConductor(...args),
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

describe('getConductorPreflight', () => {
  function preflight(
    tickets: PmTicket[],
    options: {
      dependencies?: PmDependency[];
      goals?: PmGoal[];
      goalId?: string | null;
      failed?: Record<string, number>;
      approved?: string[];
    } = {}
  ) {
    return getConductorPreflight({
      tickets,
      dependencies: options.dependencies ?? [],
      goals: options.goals ?? [],
      goalId: options.goalId ?? null,
      failedTickets: options.failed ?? {},
      approvedTickets: options.approved ?? [],
    });
  }

  it('reports nothing for an empty backlog', () => {
    expect(preflight([])).toEqual({
      ready: 0,
      blocked: 0,
      needsApproval: 0,
      inProgress: 0,
      exhausted: 0,
    });
  });

  it('counts unblocked open tickets as ready', () => {
    const result = preflight([makeTicket({ id: 'a' }), makeTicket({ id: 'b' })]);
    expect(result.ready).toBe(2);
  });

  it('counts tickets waiting on an unfinished dependency as blocked', () => {
    const result = preflight([makeTicket({ id: 'a' }), makeTicket({ id: 'b' })], {
      dependencies: [
        { id: 'd1', sourceId: 'b', targetId: 'a', targetType: 'ticket', kind: 'blocks' },
      ] as PmDependency[],
    });
    expect(result).toMatchObject({ ready: 1, blocked: 1 });
  });

  it('separates tickets that need human approval from ready work', () => {
    const result = preflight([
      makeTicket({ id: 'a' }),
      makeTicket({ id: 'b', needsHumanSupervision: true }),
    ]);
    expect(result).toMatchObject({ ready: 1, needsApproval: 1 });
  });

  it('counts an already approved supervised ticket as ready', () => {
    const result = preflight([makeTicket({ id: 'b', needsHumanSupervision: true })], {
      approved: ['b'],
    });
    expect(result).toMatchObject({ ready: 1, needsApproval: 0 });
  });

  it('counts tickets that used up their attempts as exhausted, not ready', () => {
    const result = preflight([makeTicket({ id: 'a' })], { failed: { a: MAX_TICKET_ATTEMPTS } });
    expect(result).toMatchObject({ ready: 0, exhausted: 1 });
  });

  it('counts in-progress tickets separately', () => {
    const result = preflight([makeTicket({ id: 'a', status: 'in_progress' })]);
    expect(result).toMatchObject({ ready: 0, inProgress: 1 });
  });

  it('ignores done and archived tickets', () => {
    const result = preflight([
      makeTicket({ id: 'a', status: 'done' }),
      makeTicket({ id: 'b', status: 'archived' }),
    ]);
    expect(result).toMatchObject({ ready: 0, blocked: 0, inProgress: 0 });
  });

  it('restricts the scope to the goal subtree', () => {
    const goals = [makeGoal({ id: 'g1' }), makeGoal({ id: 'g2', parentId: 'g1' })];
    const result = preflight(
      [
        makeTicket({ id: 'a', goalId: 'g1' }),
        makeTicket({ id: 'b', goalId: 'g2' }),
        makeTicket({ id: 'c', goalId: 'other' }),
        makeTicket({ id: 'd' }),
      ],
      { goals, goalId: 'g1' }
    );
    expect(result.ready).toBe(2);
  });

  it('resolves dependencies against tickets outside the goal scope', () => {
    const goals = [makeGoal({ id: 'g1' })];
    const result = preflight(
      [makeTicket({ id: 'inside', goalId: 'g1' }), makeTicket({ id: 'outside', status: 'open' })],
      {
        goals,
        goalId: 'g1',
        dependencies: [
          {
            id: 'd1',
            sourceId: 'inside',
            targetId: 'outside',
            targetType: 'ticket',
            kind: 'blocks',
          },
        ] as PmDependency[],
      }
    );
    expect(result).toMatchObject({ ready: 0, blocked: 1 });
  });
});

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

  it('buildConductorPrompt includes the goal id so MCP calls (evaluate_goal, get_goal) can target it', () => {
    const ticket = makeTicket({ name: 'Implement login' });
    const goal = makeGoal({ id: 'g-42', name: 'Ship auth' });
    const prompt = buildConductorPrompt(ticket, goal, []);
    expect(prompt).toContain('g-42');
  });

  it('starts the prompt with /goal when the ticket serves a goal', () => {
    const ticket = makeTicket({ name: 'Implement login' });
    const goal = makeGoal({ id: 'g-42', name: 'Ship auth' });
    const prompt = buildConductorPrompt(ticket, goal, []);
    expect(prompt.startsWith('/goal\n\n')).toBe(true);
  });

  it('does not prepend /goal for tickets without a goal', () => {
    const ticket = makeTicket({ name: 'Implement login' });
    const prompt = buildConductorPrompt(ticket, undefined, []);
    expect(prompt.startsWith('/goal')).toBe(false);
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

  describe('OS notifications for away moments', () => {
    it('notifies when a ticket parks on human approval', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1', name: 'Deploy', needsHumanSupervision: true })],
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();

      expect(mockNotifyConductor).toHaveBeenCalledWith('approval_needed', 'Deploy');
    });

    it('does not re-notify for a ticket already waiting for approval', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1', name: 'Deploy', needsHumanSupervision: true })],
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      await store.getState().conductorTick();

      expect(mockNotifyConductor).toHaveBeenCalledTimes(1);
    });

    it('notifies with the goal name when the goal is achieved', async () => {
      store.setState({
        goalsDraft: [makeGoal({ id: 'g1', name: 'Ship v1', status: 'in_progress' })],
        pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
      });
      store.getState().startConductor('g1');
      await store.getState().conductorTick();

      expect(mockNotifyConductor).toHaveBeenCalledWith('goal_achieved', 'Ship v1');
    });

    it('notifies with the blockers when the run ends unsatisfied', async () => {
      store.setState({
        goalsDraft: [
          makeGoal({ id: 'g1', status: 'in_progress' }),
          makeGoal({ id: 'g2', parentId: 'g1', status: 'active' }),
        ],
        pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
      });
      store.getState().startConductor('g1');
      await store.getState().conductorTick();

      expect(mockNotifyConductor).toHaveBeenCalledWith(
        'goal_blocked',
        expect.stringContaining('Sub-goal')
      );
    });

    it('notifies when an all-tickets run finishes', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1', status: 'done' })],
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();

      expect(mockNotifyConductor).toHaveBeenCalledWith('run_finished', '');
    });

    it('stays silent on a user-initiated stop — the user is at the keyboard', async () => {
      store.setState({ pmDraftTickets: [makeTicket({ id: 't1' })] });
      store.getState().startConductor(null);
      await store.getState().conductorTick();

      store.getState().stopConductor();
      await new Promise((r) => setTimeout(r, 0));

      expect(mockNotifyConductor).not.toHaveBeenCalled();
    });
  });

  describe('last run summary — what happened while you were away', () => {
    it('starts with no last run', () => {
      expect(store.getState().conductorLastRun).toBeNull();
    });

    it('records a finished summary with the completed count for an all-tickets run', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1' })],
        conductorMaxConcurrent: 1,
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();

      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'idle');
      await vi.waitFor(() => {
        expect(store.getState().conductorRunning).toBe(false);
      });

      const lastRun = store.getState().conductorLastRun;
      expect(lastRun?.outcome).toBe('finished');
      expect(lastRun?.completed).toBe(1);
      expect(lastRun?.failed).toBe(0);
      expect(lastRun?.goalName).toBeNull();
      expect(lastRun?.startedAt).toBeTruthy();
      expect(lastRun?.endedAt).toBeTruthy();
    });

    it('records a goal_achieved summary with the goal name', async () => {
      store.setState({
        goalsDraft: [makeGoal({ id: 'g1', name: 'Ship v1', status: 'in_progress' })],
        pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
      });
      store.getState().startConductor('g1');
      await store.getState().conductorTick();

      const lastRun = store.getState().conductorLastRun;
      expect(lastRun?.outcome).toBe('goal_achieved');
      expect(lastRun?.goalName).toBe('Ship v1');
    });

    it('records a goal_blocked summary with the blockers spelled out', async () => {
      store.setState({
        goalsDraft: [
          makeGoal({ id: 'g1', name: 'Ship v1', status: 'in_progress' }),
          makeGoal({ id: 'g2', parentId: 'g1', status: 'active' }),
        ],
        pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
      });
      store.getState().startConductor('g1');
      await store.getState().conductorTick();

      const lastRun = store.getState().conductorLastRun;
      expect(lastRun?.outcome).toBe('goal_blocked');
      expect(lastRun?.goalName).toBe('Ship v1');
      expect(lastRun?.blockers.join(' ')).toContain('Sub-goal');
    });

    it('records a user_stopped summary when the user stops the run', async () => {
      store.setState({ pmDraftTickets: [makeTicket({ id: 't1' })] });
      store.getState().startConductor(null);
      await store.getState().conductorTick();

      store.getState().stopConductor();
      await new Promise((r) => setTimeout(r, 0));

      expect(store.getState().conductorLastRun?.outcome).toBe('user_stopped');
    });

    it('does not overwrite the summary when stop is called while already stopped', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1', status: 'done' })],
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      expect(store.getState().conductorLastRun?.outcome).toBe('finished');

      store.getState().stopConductor();
      expect(store.getState().conductorLastRun?.outcome).toBe('finished');
    });

    it('counts tickets that exhausted their attempts as failed', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1' })],
        conductorMaxConcurrent: 1,
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();

      // Two errors → attempts exhausted → run ends with the ticket given up
      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'error');
      await vi.waitFor(() => {
        expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
      });
      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'error');
      await vi.waitFor(() => {
        expect(store.getState().conductorRunning).toBe(false);
      });

      const lastRun = store.getState().conductorLastRun;
      expect(lastRun?.failed).toBe(1);
      expect(lastRun?.completed).toBe(0);
    });

    it('resets the counters for a new run', async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1' })],
        conductorMaxConcurrent: 1,
      });
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'idle');
      await vi.waitFor(() => {
        expect(store.getState().conductorLastRun?.completed).toBe(1);
      });

      // Second run over an already-done board finishes immediately
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      expect(store.getState().conductorLastRun?.completed).toBe(0);
    });
  });
});

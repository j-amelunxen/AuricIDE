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
import type { PmGoal, PmGoalStation } from '../tauri/goals';
import { spawnAgent } from '../tauri/agents';
import { createJudgeBackend, type JudgeInput, type JudgeStart } from '../conductor/judgeBackend';

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

vi.mock('../conductor/judgeBackend', () => ({
  createJudgeBackend: vi.fn(),
  buildReviewAgentPrompt: vi.fn(() => 'review prompt'),
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

function makeStation(overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: 's1',
    goalId: 'g1',
    name: 'Build it',
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate: { type: 'undefined' },
    evidenceNote: '',
    ticketId: 't1',
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
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
      total: 0,
      done: 0,
      ready: 0,
      blocked: 0,
      needsApproval: 0,
      inProgress: 0,
      inReview: 0,
      exhausted: 0,
    });
  });

  it('reports total and completed tickets for actionable empty-state copy', () => {
    expect(
      preflight([makeTicket({ status: 'done' }), makeTicket({ status: 'in_review' })])
    ).toMatchObject({ total: 2, done: 1, inReview: 1 });
  });

  it('counts unblocked open tickets as ready', () => {
    const result = preflight([makeTicket({ id: 'a' }), makeTicket({ id: 'b' })]);
    expect(result.ready).toBe(2);
  });

  it('counts tickets waiting on an unfinished dependency as blocked', () => {
    const result = preflight([makeTicket({ id: 'a' }), makeTicket({ id: 'b' })], {
      dependencies: [
        {
          id: 'd1',
          sourceType: 'ticket',
          sourceId: 'b',
          targetId: 'a',
          targetType: 'ticket',
        },
      ],
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

  it('counts tickets awaiting the judge as in_review, never ready', () => {
    const result = preflight([makeTicket({ id: 'a', status: 'in_review' })]);
    expect(result).toMatchObject({ ready: 0, inProgress: 0, inReview: 1 });
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
            sourceType: 'ticket',
            sourceId: 'inside',
            targetId: 'outside',
            targetType: 'ticket',
          },
        ],
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

  it('getUnblockedOpenTickets never re-picks an in_review ticket', () => {
    const tickets = [
      makeTicket({ id: 'a', status: 'in_review' }),
      makeTicket({ id: 'b', status: 'open' }),
    ];
    expect(getUnblockedOpenTickets(tickets, [], tickets).map((t) => t.id)).toEqual(['b']);
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

  it('spawns the implementer headless so the process exits when the work is done', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    const mockSpawn = vi.mocked(spawnAgent);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    // The whole loop is driven by the agent's exit code: an interactive CLI
    // returns to its prompt when it is finished and never exits, so the ticket
    // would stay in_progress forever and the run would never advance.
    expect(mockSpawn.mock.calls[0][0].headless).toBe(true);
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

  it('does not auto-achieve past an open human station', async () => {
    store.setState({
      goalsDraft: [makeGoal({ id: 'g1', status: 'in_progress' })],
      pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
      goalStationsDraft: [
        {
          id: 's1',
          goalId: 'g1',
          name: 'Call the customer',
          kind: 'human',
          status: 'planned',
          evidenceKind: 'human',
          predicate: { type: 'human' },
          evidenceNote: '',
          ticketId: null,
          lane: 0,
          sortOrder: 0,
          lastCheckedAt: null,
          doneAt: null,
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
        },
      ],
    });
    store.getState().startConductor('g1');
    await store.getState().conductorTick();

    // All tickets are done, but the human step is not — the goal must NOT
    // auto-achieve past "call the customer".
    expect(store.getState().goalsDraft[0].status).not.toBe('achieved');
    expect(store.getState().conductorRunning).toBe(false);
    const stopDecision = store.getState().conductorDecisions.find((d) => d.action === 'stop');
    expect(stopDecision?.detail).toContain('Call the customer');
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
    expect(stopDecision?.detail).toContain('Add work before running the conductor');
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

  describe('ticket budget and per-run options', () => {
    it("defaults to an unlimited budget — today's behaviour is unchanged", async () => {
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1' }), makeTicket({ id: 't2' })],
        conductorMaxConcurrent: 2,
      });
      store.getState().startConductor(null);
      expect(store.getState().conductorTicketBudget).toBeNull();

      await store.getState().conductorTick();
      expect(Object.keys(store.getState().conductorAssignments).sort()).toEqual(['t1', 't2']);
    });

    it('stops starting new tickets once the budget is spawned and ends with budget_reached', async () => {
      store.setState({
        goalsDraft: [makeGoal({ id: 'g1', status: 'in_progress' })],
        pmDraftTickets: [
          makeTicket({ id: 't1', goalId: 'g1' }),
          makeTicket({ id: 't2', goalId: 'g1' }),
          makeTicket({ id: 't3', goalId: 'g1' }),
          makeTicket({ id: 't4', goalId: 'g1' }),
          makeTicket({ id: 't5', goalId: 'g1' }),
        ],
      });
      store.getState().startConductor('g1', { ticketBudget: 2, maxConcurrent: 5 });
      await store.getState().conductorTick();

      // Only two of the five ready tickets were spawned, despite five slots
      // of concurrency being available.
      expect(Object.keys(store.getState().conductorAssignments).sort()).toEqual(['t1', 't2']);
      expect(store.getState().conductorRunSpawned).toBe(2);

      const [agentA, agentB] = Object.values(store.getState().conductorAssignments);
      store.getState().conductorHandleAgentStatus(agentA, 'idle');
      store.getState().conductorHandleAgentStatus(agentB, 'idle');

      await vi.waitFor(() => {
        expect(store.getState().conductorRunning).toBe(false);
      });

      const lastRun = store.getState().conductorLastRun;
      expect(lastRun?.outcome).toBe('budget_reached');
      expect(lastRun?.spawned).toBe(2);
      expect(lastRun?.ticketBudget).toBe(2);
      // Stopped because it was told to, not because the goal was checked:
      // three tickets are still open, so a real evaluation would report them.
      expect(lastRun?.blockers).toEqual([]);
      expect(store.getState().goalsDraft[0].status).toBe('in_progress');
      expect(store.getState().conductorDecisions.some((d) => d.action === 'goal_achieved')).toBe(
        false
      );
    });

    it('does not spend a second budget unit when a failed ticket is requeued', async () => {
      store.setState({
        pmDraftTickets: [
          makeTicket({ id: 't1', priority: 'critical' }),
          makeTicket({ id: 't2', priority: 'high' }),
        ],
        conductorMaxConcurrent: 1,
      });
      store.getState().startConductor(null, { ticketBudget: 2 });
      await store.getState().conductorTick();
      expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
      expect(store.getState().conductorRunSpawned).toBe(1);

      // t1 fails and is requeued — the retry is the same ticket, so the
      // budget does not move.
      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'error');
      await vi.waitFor(() => {
        expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
      });
      expect(store.getState().conductorRunSpawned).toBe(1);

      // t1 now succeeds — the second distinct ticket, t2, still gets its slot.
      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'idle');
      await vi.waitFor(() => {
        expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t2']);
      });
      expect(store.getState().conductorRunSpawned).toBe(2);
    });

    it('still retries the last budgeted ticket after it fails, instead of ending the run', async () => {
      store.setState({ pmDraftTickets: [makeTicket({ id: 't1' })], conductorMaxConcurrent: 1 });
      store.getState().startConductor(null, { ticketBudget: 1 });
      await store.getState().conductorTick();
      expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);

      // The only budgeted ticket errors: nothing is in flight and the budget is
      // spent, but the ticket still has an attempt left — the run must relaunch
      // it rather than declare the budget reached with the ticket abandoned.
      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'error');
      await vi.waitFor(() => {
        expect(Object.keys(store.getState().conductorAssignments)).toEqual(['t1']);
      });
      expect(store.getState().conductorRunning).toBe(true);
      expect(store.getState().conductorLastRun).toBeNull();
    });

    it('keeps the panel values to restore when a second start arrives without options', async () => {
      store.setState({
        conductorMaxConcurrent: 3,
        conductorRequireReview: false,
        pmDraftTickets: [],
      });
      store.getState().startConductor(null, { maxConcurrent: 1, requireReview: true });
      // A nested start (nothing in the UI guards every caller) must not forget
      // what the schedule's run has to hand back.
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      expect(store.getState().conductorRunning).toBe(false);
      expect(store.getState().conductorMaxConcurrent).toBe(3);
      expect(store.getState().conductorRequireReview).toBe(false);
    });

    it('restores maxConcurrent and requireReview to their previous values when the run ends', async () => {
      store.setState({
        conductorMaxConcurrent: 3,
        conductorRequireReview: false,
        pmDraftTickets: [],
      });
      store.getState().startConductor(null, { maxConcurrent: 1, requireReview: true });
      expect(store.getState().conductorMaxConcurrent).toBe(1);
      expect(store.getState().conductorRequireReview).toBe(true);

      // No tickets → the run finishes on the very first tick.
      await store.getState().conductorTick();

      expect(store.getState().conductorRunning).toBe(false);
      expect(store.getState().conductorMaxConcurrent).toBe(3);
      expect(store.getState().conductorRequireReview).toBe(false);
    });

    it('leaves maxConcurrent untouched when no override was given', async () => {
      store.setState({ conductorMaxConcurrent: 3, pmDraftTickets: [] });
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      expect(store.getState().conductorMaxConcurrent).toBe(3);
    });

    it('does not reach the budget outcome while a review agent is still in flight', async () => {
      // hasActiveAgents counts reviewers as well as implementers. Without
      // that, a run whose last ticket is sitting with the judge would report
      // budget_reached and halt, abandoning the verdict.
      vi.mocked(createJudgeBackend).mockReturnValue({
        form: 'llm',
        start: vi.fn(() => new Promise<never>(() => {})),
      });
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1' })],
        conductorMaxConcurrent: 1,
      });
      store.getState().startConductor(null, { ticketBudget: 1, requireReview: true });
      await store.getState().conductorTick();

      store
        .getState()
        .conductorHandleAgentStatus(store.getState().conductorAssignments['t1'], 'idle');
      await new Promise((r) => setTimeout(r, 20));
      expect(store.getState().conductorReviewAssignments['t1']).toBeDefined();
      expect(store.getState().conductorAssignments).toEqual({});

      // startReview parks on the judge without re-ticking, so the tick that
      // would end the run comes from the heartbeat. Drive it by hand — that
      // is the moment the review has to count as work in flight.
      await store.getState().conductorTick();

      expect(store.getState().conductorRunning).toBe(true);
      expect(store.getState().conductorLastRun?.outcome).not.toBe('budget_reached');
    });

    it('restores the overrides when a human stops a scheduled run by hand', async () => {
      // user_stopped is a run end like any other; halt() is on that path too,
      // so a schedule must not leave the panel on its own concurrency.
      store.setState({
        conductorMaxConcurrent: 4,
        conductorRequireReview: false,
        pmDraftTickets: [makeTicket({ id: 't1' })],
      });
      store
        .getState()
        .startConductor(null, { maxConcurrent: 1, requireReview: true, ticketBudget: 5 });
      await store.getState().conductorTick();
      expect(store.getState().conductorMaxConcurrent).toBe(1);

      store.getState().stopConductor('by hand');
      await new Promise((r) => setTimeout(r, 20));

      expect(store.getState().conductorLastRun?.outcome).toBe('user_stopped');
      expect(store.getState().conductorMaxConcurrent).toBe(4);
      expect(store.getState().conductorRequireReview).toBe(false);
    });

    it('records the origin in the start decision', () => {
      store.setState({ pmDraftTickets: [] });
      store.getState().startConductor('g1', { origin: 'Nightly factory' });
      const startDecision = store.getState().conductorDecisions.find((d) => d.action === 'start');
      expect(startDecision?.detail).toContain('Nightly factory');
      expect(startDecision?.detail).toContain('g1');
    });

    it('carries the ticket budget on the run summary', async () => {
      store.setState({ pmDraftTickets: [] });
      store.getState().startConductor(null, { ticketBudget: 5 });
      await store.getState().conductorTick();
      expect(store.getState().conductorLastRun?.ticketBudget).toBe(5);
    });

    it('carries a null ticket budget on the run summary when none was set', async () => {
      store.setState({ pmDraftTickets: [] });
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      expect(store.getState().conductorLastRun?.ticketBudget).toBeNull();
    });
  });
});

describe('conductor judge review gate', () => {
  let store: StoreApi<StoreState>;

  const flush = () => new Promise((r) => setTimeout(r, 20));

  const mockVerdict = (verdict: { pass: boolean; reason: string }) => {
    vi.mocked(createJudgeBackend).mockReturnValue({
      form: 'llm',
      start: vi.fn(async () => ({ kind: 'verdict' as const, verdict })),
    });
  };

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

  async function runToIdle(requireReview: boolean): Promise<string> {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
      conductorRequireReview: requireReview,
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    return store.getState().conductorAssignments['t1'];
  }

  it('with review OFF, a finished ticket goes straight to done (regression)', async () => {
    const agentId = await runToIdle(false);
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('done');
    expect(vi.mocked(createJudgeBackend)).not.toHaveBeenCalled();
  });

  it('marks a linked non-human checkpoint claimed when an implementer finishes without review', async () => {
    const agentId = await runToIdle(false);
    store.setState({ goalStationsDraft: [makeStation()] });
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    const station = store.getState().goalStationsDraft[0];
    expect(station).toMatchObject({ status: 'done', evidenceKind: 'claim' });
    expect(station.evidenceNote).toMatch(/ticket.*completed/i);
    expect(station.doneAt).not.toBeNull();
  });

  it('never auto-ticks a linked human checkpoint', async () => {
    const agentId = await runToIdle(false);
    store.setState({
      goalStationsDraft: [
        makeStation({ kind: 'human', evidenceKind: 'human', predicate: { type: 'human' } }),
      ],
    });
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().goalStationsDraft[0].status).toBe('planned');
  });

  it('with review ON and a passing judge: in_progress → in_review → done', async () => {
    mockVerdict({ pass: true, reason: 'criteria met' });
    const agentId = await runToIdle(true);
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('in_progress');
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('done');
    expect(store.getState().conductorRunCompleted).toBe(1);
    expect(store.getState().conductorReviewAssignments).toEqual({});
  });

  it('records a passing judge verdict as judged evidence on the linked checkpoint', async () => {
    mockVerdict({ pass: true, reason: 'criteria met' });
    const agentId = await runToIdle(true);
    store.setState({ goalStationsDraft: [makeStation()] });
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    const station = store.getState().goalStationsDraft[0];
    expect(station).toMatchObject({ status: 'done', evidenceKind: 'judged' });
    expect(station.evidenceNote).toContain('criteria met');
    expect(station.lastCheckedAt).not.toBeNull();
  });

  it('with review ON and a rejecting judge: reopened as an attempt with the reason', async () => {
    mockVerdict({ pass: false, reason: 'not actually done' });
    const agentId = await runToIdle(true);
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    // Reopened counts as an attempt (the shared ledger); the reason is logged.
    // The loop then respawns for the retry, so the status is no longer 'done'.
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).not.toBe('done');
    expect(
      store.getState().conductorDecisions.some((d) => d.detail.includes('not actually done'))
    ).toBe(true);
    expect(store.getState().conductorReviewAssignments).toEqual({});
  });

  it('does not complete the linked checkpoint when the judge rejects', async () => {
    mockVerdict({ pass: false, reason: 'not done' });
    const agentId = await runToIdle(true);
    store.setState({ goalStationsDraft: [makeStation()] });
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().goalStationsDraft[0].status).toBe('planned');
  });

  it('a judge that cannot even start rejects the ticket (never a silent pass)', async () => {
    vi.mocked(createJudgeBackend).mockImplementation(() => {
      throw new Error('no judge configured');
    });
    const agentId = await runToIdle(true);
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    // A judge that cannot start is a rejection: the ticket is reopened as an
    // attempt, never marked done.
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).not.toBe('done');
  });

  it('two rejections exhaust the ticket and it is not re-picked', async () => {
    mockVerdict({ pass: false, reason: 'still wrong' });
    // First attempt.
    let agentId = await runToIdle(true);
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
    // The reopen re-drove the tick, which respawned for the second attempt.
    agentId = store.getState().conductorAssignments['t1'];
    expect(agentId).toBeTruthy();
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().conductorFailedTickets['t1']).toBe(MAX_TICKET_ATTEMPTS);
    // Exhausted: never spawned again.
    expect(store.getState().conductorAssignments['t1']).toBeUndefined();
  });

  it('agent form: the reviewer is spawned headless, like the implementer', async () => {
    // Drive the real spawnReviewAgent seam instead of a stubbed backend — the
    // injected dependency is what carries the flag, so stubbing the backend
    // would leave exactly the code under test unexercised.
    vi.mocked(createJudgeBackend).mockImplementation((form, deps) => ({
      form,
      start: async (input: JudgeInput): Promise<JudgeStart> => ({
        kind: 'delegated',
        reviewAgentId: await deps!.spawnReviewAgent(input),
      }),
    }));
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
      conductorRequireReview: true,
      conductorJudgeForm: 'agent',
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    const implId = store.getState().conductorAssignments['t1'];
    store.getState().conductorHandleAgentStatus(implId, 'idle');
    await flush();

    const reviewCall = vi
      .mocked(spawnAgent)
      .mock.calls.find((c) => c[0].name.startsWith('review:'));
    expect(reviewCall).toBeDefined();
    // A reviewer left at an interactive prompt writes no verdict and never
    // exits — it would only ever resolve through the 10-minute timeout, which
    // rejects the ticket for the reviewer's failure rather than the work's.
    expect(reviewCall![0].headless).toBe(true);
  });

  describe('which harness the reviewer runs on', () => {
    // A judge that is the same provider and the same model as the implementer
    // is not an independent one, so both are their own setting. They are only
    // *defaulted* to the conductor's, because silently reviewing on a harness
    // nobody chose would be its own surprise.
    const driveRealSpawn = () => {
      vi.mocked(createJudgeBackend).mockImplementation((form, deps) => ({
        form,
        start: async (input: JudgeInput): Promise<JudgeStart> => ({
          kind: 'delegated',
          reviewAgentId: await deps!.spawnReviewAgent(input),
        }),
      }));
    };

    const spawnReviewerFor = async (): Promise<{ provider?: string; model?: string }> => {
      store.getState().startConductor(null);
      await store.getState().conductorTick();
      const implId = store.getState().conductorAssignments['t1'];
      store.getState().conductorHandleAgentStatus(implId, 'idle');
      await flush();
      const call = vi.mocked(spawnAgent).mock.calls.find((c) => c[0].name.startsWith('review:'));
      expect(call).toBeDefined();
      return { provider: call![0].provider, model: call![0].model };
    };

    beforeEach(() => {
      driveRealSpawn();
      store.setState({
        pmDraftTickets: [makeTicket({ id: 't1' })],
        conductorMaxConcurrent: 1,
        conductorRequireReview: true,
        conductorJudgeForm: 'agent',
        conductorProviderId: 'implementer-cli',
        conductorModel: 'implementer-model',
      });
    });

    it('runs the reviewer on the judge’s own provider and model', async () => {
      store.setState({
        conductorJudgeProviderId: 'judge-cli',
        conductorJudgeModel: 'judge-model',
      });

      await expect(spawnReviewerFor()).resolves.toEqual({
        provider: 'judge-cli',
        model: 'judge-model',
      });
    });

    it('falls back to the conductor’s harness when the judge names none', async () => {
      store.setState({ conductorJudgeProviderId: null, conductorJudgeModel: null });

      await expect(spawnReviewerFor()).resolves.toEqual({
        provider: 'implementer-cli',
        model: 'implementer-model',
      });
    });

    it('takes each half on its own — a judge provider with no judge model', async () => {
      store.setState({ conductorJudgeProviderId: 'judge-cli', conductorJudgeModel: null });

      await expect(spawnReviewerFor()).resolves.toEqual({
        provider: 'judge-cli',
        model: 'implementer-model',
      });
    });
  });

  describe('a schedule’s judge settings belong to its run', () => {
    it('applies them for the run and hands the panel’s back when it ends', async () => {
      store.setState({
        pmDraftTickets: [],
        conductorJudgeForm: 'llm',
        conductorJudgeProviderId: null,
        conductorJudgeModel: null,
      });

      store.getState().startConductor(null, {
        requireReview: true,
        judgeForm: 'agent',
        judgeProviderId: 'judge-cli',
        judgeModel: 'judge-model',
      });
      expect(store.getState().conductorJudgeForm).toBe('agent');
      expect(store.getState().conductorJudgeProviderId).toBe('judge-cli');
      expect(store.getState().conductorJudgeModel).toBe('judge-model');

      // No tickets → the run finishes on the very first tick.
      await store.getState().conductorTick();

      expect(store.getState().conductorJudgeForm).toBe('llm');
      expect(store.getState().conductorJudgeProviderId).toBeNull();
      expect(store.getState().conductorJudgeModel).toBeNull();
    });

    it('leaves the judge settings alone when the schedule names none', async () => {
      store.setState({
        pmDraftTickets: [],
        conductorJudgeForm: 'agent',
        conductorJudgeProviderId: 'panel-cli',
        conductorJudgeModel: 'panel-model',
      });

      store.getState().startConductor(null, { requireReview: true });
      await store.getState().conductorTick();

      expect(store.getState().conductorJudgeForm).toBe('agent');
      expect(store.getState().conductorJudgeProviderId).toBe('panel-cli');
      expect(store.getState().conductorJudgeModel).toBe('panel-model');
    });
  });

  it('agent form: implementer done → reviewer spawned → verdict collected → done', async () => {
    vi.mocked(createJudgeBackend).mockReturnValue({
      form: 'agent',
      start: vi.fn(async () => ({ kind: 'delegated' as const, reviewAgentId: 'rev-1' })),
      collectVerdict: vi.fn(async () => ({ pass: true, reason: 'approved' })),
    });
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
      conductorRequireReview: true,
      conductorJudgeForm: 'agent',
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    const implId = store.getState().conductorAssignments['t1'];
    store.getState().conductorHandleAgentStatus(implId, 'idle');
    await flush();
    // Delegated to the spawned reviewer; ticket sits in review.
    expect(store.getState().conductorReviewAssignments['t1']).toBe('rev-1');
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('in_review');
    // The reviewer exits → its verdict is collected → ticket done.
    store.getState().conductorHandleAgentStatus('rev-1', 'idle');
    await flush();
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('done');
  });

  it('agent form: a reviewer that exits with no verdict is treated as a rejection', async () => {
    vi.mocked(createJudgeBackend).mockReturnValue({
      form: 'agent',
      start: vi.fn(async () => ({ kind: 'delegated' as const, reviewAgentId: 'rev-1' })),
      collectVerdict: vi.fn(async () => null), // no row written
    });
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1' })],
      conductorMaxConcurrent: 1,
      conductorRequireReview: true,
      conductorJudgeForm: 'agent',
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    const implId = store.getState().conductorAssignments['t1'];
    store.getState().conductorHandleAgentStatus(implId, 'idle');
    await flush();
    store.getState().conductorHandleAgentStatus('rev-1', 'idle');
    await flush();
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).not.toBe('done');
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
  });

  it('killing a review agent reopens the ticket — never marks it done (false-approval trap)', async () => {
    // A real review agent (agent form) whose kill must NOT fall through to the
    // manual-kill branch that would mark spawnedByTicketId done.
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1', status: 'in_review' })],
      agents: [
        {
          id: 'rev-1',
          name: 'reviewer',
          model: 'opus',
          provider: 'claude',
          status: 'running',
          currentTask: 'review t1',
          startedAt: 1000,
          spawnedByTicketId: 't1',
        },
      ],
      conductorRunning: true,
      conductorReviewAssignments: { t1: 'rev-1' },
      conductorReviewStartedAt: { t1: 1000 },
    });
    await store.getState().killRunningAgent('rev-1');
    await flush();
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).not.toBe('done');
    expect(store.getState().conductorReviewAssignments['t1']).toBeUndefined();
  });

  it('reopens a done ticket whose linked station-claim the judge rejected (bounded)', async () => {
    const station = {
      id: 's1',
      goalId: 'g1',
      name: 'Build parser',
      kind: 'normal' as const,
      status: 'done' as const,
      evidenceKind: 'claim' as const,
      predicate: { type: 'undefined' as const },
      evidenceNote: 'rejected: vague',
      ticketId: 't1',
      lane: 0,
      sortOrder: 0,
      lastCheckedAt: '2026-01-01 00:00:00', // a judge ruled and rejected it
      doneAt: '2026-01-01 00:00:00',
      createdAt: '',
      updatedAt: '',
    };
    store.setState({
      goalsDraft: [makeGoal({ id: 'g1' })],
      pmDraftTickets: [makeTicket({ id: 't1', goalId: 'g1', status: 'done' })],
      goalStationsDraft: [station],
      conductorRunning: true,
      conductorGoalId: 'g1',
    });
    await store.getState().conductorTick();
    await flush();
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
    const st = store.getState().goalStationsDraft.find((s) => s.id === 's1');
    expect(st?.status).toBe('planned'); // reset for rework
    expect(st?.lastCheckedAt).toBeNull(); // a re-claim will be judged anew
  });

  it('times out a review with no verdict into a rejection, once', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1', status: 'in_review' })],
      agents: [
        {
          id: 'rev-1',
          name: 'reviewer',
          model: 'opus',
          provider: 'claude',
          status: 'running',
          currentTask: '',
          startedAt: 1000,
          spawnedForReviewOfTicketId: 't1',
        },
      ],
      conductorRunning: true,
      conductorReviewAssignments: { t1: 'rev-1' },
      conductorReviewStartedAt: { t1: 1000 }, // ancient → past REVIEW_TIMEOUT_MS
    });
    await store.getState().conductorTick();
    await flush();
    expect(store.getState().conductorReviewAssignments['t1']).toBeUndefined();
    // Timed out = one rejection attempt, not a double-count.
    expect(store.getState().conductorFailedTickets['t1']).toBe(1);
  });

  it('a review in flight counts toward capacity and keeps the run active', async () => {
    // A judge whose verdict never resolves keeps the ticket in review.
    vi.mocked(createJudgeBackend).mockReturnValue({
      form: 'llm',
      start: vi.fn((_input: JudgeInput) => new Promise<JudgeStart>(() => {})), // never resolves
    });
    const agentId = await runToIdle(true);
    store.getState().conductorHandleAgentStatus(agentId, 'idle');
    await flush();
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.status).toBe('in_review');
    expect(store.getState().conductorReviewAssignments['t1']).toBeTruthy();
    // The implementer slot was freed but the review holds the budget.
    expect(store.getState().conductorAssignments['t1']).toBeUndefined();
  });
});

describe('conductor milestones in the notification inbox', () => {
  let store: StoreApi<StoreState>;

  beforeEach(async () => {
    vi.clearAllMocks();
    agentCounter = 0;
    const { createNotificationsSlice } = await import('./notificationsSlice');
    // @ts-expect-error - Partial store for testing
    store = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createGoalsSlice(...a),
      ...createPmSlice(...a),
      ...createConductorSlice(...a),
      ...createNotificationsSlice(...a),
    }));
  });

  /**
   * The dispatch is fire-and-forget and reaches the store only after the IPC
   * layer's dynamic import settles, which is more than one tick — poll rather
   * than guess a delay.
   */
  async function inboxSize(count: number) {
    await vi.waitFor(() => {
      expect(store.getState().notifications.length).toBe(count);
    });
  }

  /** Nothing arrived, and stayed not arrived. */
  async function inboxStaysEmpty() {
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().notifications).toHaveLength(0);
  }

  it('records a pending approval and points at the ticket', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1', name: 'Deploy', needsHumanSupervision: true })],
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    await inboxSize(1);

    const [entry] = store.getState().notifications;
    expect(entry.title).toContain('Deploy');
    expect(entry.severity).toBe('warn');
    expect(entry.refKind).toBe('ticket');
    expect(entry.refId).toBe('t1');
    // A pointer to where the decision is made, not a second Approve button —
    // two places to approve could disagree about what is still pending.
    expect(entry.actions).toEqual([
      {
        id: 'open',
        label: 'Open approval',
        kind: 'open',
        target: { type: 'ticket', ticketId: 't1' },
      },
    ]);
  });

  it('keeps one entry per parked ticket across ticks', async () => {
    store.setState({
      pmDraftTickets: [makeTicket({ id: 't1', name: 'Deploy', needsHumanSupervision: true })],
    });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    await store.getState().conductorTick();
    await inboxSize(1);

    // Settled, and still one — a second tick must not add a duplicate.
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().notifications).toHaveLength(1);
  });

  it('records a blocked goal with its blockers', async () => {
    store.setState({
      goalsDraft: [makeGoal({ id: 'g1', name: 'Ship v1', status: 'in_progress' })],
      pmDraftTickets: [],
    });
    store.getState().startConductor('g1');
    await store.getState().conductorTick();
    await inboxSize(1);

    const entry = store.getState().notifications.find((n) => n.title.includes('Goal blocked'));
    expect(entry).toBeTruthy();
    expect(entry?.refKind).toBe('goal');
    expect(entry?.body).toBeTruthy();
  });

  it('records a finished run', async () => {
    store.setState({ pmDraftTickets: [] });
    store.getState().startConductor(null);
    await store.getState().conductorTick();
    await inboxSize(1);

    expect(
      store.getState().notifications.some((n) => n.title.includes('Conductor run finished'))
    ).toBe(true);
  });

  // The conductor is about to retry by itself; an entry now would be an alarm
  // for something the system is still handling.
  it('records nothing while a ticket is simply being worked', async () => {
    store.setState({ pmDraftTickets: [makeTicket({ id: 't1', name: 'Build' })] });
    store.getState().startConductor(null);
    await store.getState().conductorTick();

    await inboxStaysEmpty();
  });
});

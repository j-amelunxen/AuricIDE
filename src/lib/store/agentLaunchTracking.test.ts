import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import { createGoalsSlice } from './goalsSlice';
import type { StoreState } from './index';
import { goalsLoad, goalsSave, type PmGoal, type PmGoalRun } from '../tauri/goals';

vi.mock('../tauri/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawnAgent: vi.fn(async (config: any) => ({
    id: 'agent-7',
    name: config.name,
    model: config.model,
    provider: config.provider || 'claude',
    status: 'running' as const,
    currentTask: config.task,
    startedAt: 1000,
    spawnedByGoalId: config.spawnedByGoalId,
  })),
  killAgent: vi.fn(async () => undefined),
  resumeInterruptedAgent: vi.fn(),
  discardInterruptedAgent: vi.fn(async () => undefined),
  listAgents: vi.fn(async () => []),
  recordAgentPromptHistory: vi.fn(async () => undefined),
}));

vi.mock('../tauri/goals', () => ({
  goalsLoad: vi.fn(async () => ({ goals: [], goalRuns: [], requirementLinks: [] })),
  goalsSave: vi.fn(async () => ({ conflicts: [] })),
  goalsClear: vi.fn(async () => undefined),
}));

vi.mock('../tauri/db', () => ({ initProjectDb: vi.fn(async () => undefined) }));

const recordLaunchRun = vi.fn(async (_input: unknown) => undefined);
vi.mock('../tauri/notifications', () => ({
  notificationsRecordLaunchRun: (input: unknown) => recordLaunchRun(input),
}));

function goal(): PmGoal {
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
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  };
}

describe('agents started from a launch request are tracked', () => {
  let store: StoreApi<StoreState>;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - Partial store for testing (only agent+goals slices)
    store = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createGoalsSlice(...a),
    }));
    store.setState({ goalsDraft: [goal()] });
  });

  const spawn = (extra: Record<string, unknown> = {}) =>
    store.getState().spawnNewAgent({
      name: 'Worker',
      model: 'gpt',
      task: 'work',
      provider: 'codex',
      spawnedByGoalId: 'g1',
      launchRequestUid: 'req-1',
      ...extra,
    });

  it('appears in the agent list and is bound to its goal', async () => {
    await spawn();

    expect(store.getState().agents.map((a) => a.id)).toEqual(['agent-7']);
    const [run] = store.getState().goalRunsDraft;
    expect(run).toMatchObject({ goalId: 'g1', agentId: 'agent-7', outcome: 'running' });
  });

  // Goal 10, station 2: the backend records `running` at the spawn, before
  // the process can end; a second write from here could only arrive late.
  it('leaves the running record to the backend', async () => {
    await spawn();

    expect(recordLaunchRun).not.toHaveBeenCalled();
  });

  // Goal 10, station 2: a run so short that its exit arrives before the spawn
  // call has returned. The exit must still end the agent and its goal run.
  it('keeps an exit that arrives before the agent is registered', async () => {
    const { spawnAgent } = await import('../tauri/agents');
    const real = vi.mocked(spawnAgent).getMockImplementation()!;
    vi.mocked(spawnAgent).mockImplementationOnce(async (config) => {
      const agent = await real(config);
      store.getState().updateAgentStatus(agent.id, 'idle');
      return agent;
    });

    await spawn();

    expect(store.getState().agents[0]).toMatchObject({ id: 'agent-7', status: 'idle' });
    expect(store.getState().goalRunsDraft[0]).toMatchObject({ outcome: 'completed' });
    expect(recordLaunchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestUid: 'req-1', agentId: 'agent-7', status: 'completed' })
    );
  });

  // Review r1: a resumed agent keeps reporting to its request, and a stop
  // that arrives before the resume call has returned still ends it.
  it('keeps the request of a resumed agent and an exit before the resume returns', async () => {
    const { resumeInterruptedAgent } = await import('../tauri/agents');
    store.setState({
      interruptedAgents: [
        {
          id: 'agent-2',
          name: 'Worker',
          model: 'gpt',
          provider: 'codex',
          task: 'work',
          dangerouslyIgnorePermissions: false,
          autoAcceptEdits: false,
          headless: false,
          startedAt: 1,
          spawnedByGoalId: 'g1',
          launchRequestUid: 'req-1',
        },
      ],
    });
    vi.mocked(resumeInterruptedAgent).mockImplementationOnce(async () => {
      store.getState().updateAgentStatus('agent-12', 'idle');
      return {
        id: 'agent-12',
        name: 'Worker',
        model: 'gpt',
        provider: 'codex',
        status: 'running',
        currentTask: 'work',
        startedAt: 2,
      };
    });

    await store.getState().resumeInterruptedAgent('agent-2');

    expect(store.getState().agentSpawnConfigs['agent-12']).toMatchObject({
      launchRequestUid: 'req-1',
    });
    expect(store.getState().agents[0]).toMatchObject({ id: 'agent-12', status: 'idle' });
    expect(recordLaunchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestUid: 'req-1', agentId: 'agent-12', status: 'completed' })
    );
  });

  // Review r2: the goal run the old agent left running follows the resume,
  // and an early end of the resumed agent closes it.
  it.each([
    ['idle', 'completed'],
    ['error', 'failed'],
  ] as const)(
    'moves the running goal run to the resumed agent and closes it on an early %s',
    async (stop, outcome) => {
      const { resumeInterruptedAgent } = await import('../tauri/agents');
      store.setState({
        interruptedAgents: [
          {
            id: 'agent-2',
            name: 'Worker',
            model: 'gpt',
            provider: 'codex',
            task: 'work',
            dangerouslyIgnorePermissions: false,
            autoAcceptEdits: false,
            headless: false,
            startedAt: 1,
            spawnedByGoalId: 'g1',
          },
        ],
        goalRunsDraft: [
          {
            id: 'run-1',
            goalId: 'g1',
            agentId: 'agent-2',
            ticketId: null,
            prompt: 'work',
            model: 'gpt',
            provider: 'codex',
            source: 'ui',
            outcome: 'running',
            summary: '',
            startedAt: '2026-09-27 01:00:00',
            finishedAt: null,
          },
        ],
      });
      vi.mocked(resumeInterruptedAgent).mockImplementationOnce(async () => {
        store.getState().updateAgentStatus('agent-12', stop);
        return {
          id: 'agent-12',
          name: 'Worker',
          model: 'gpt',
          provider: 'codex',
          status: 'running',
          currentTask: 'work',
          startedAt: 2,
        };
      });

      await store.getState().resumeInterruptedAgent('agent-2');

      expect(store.getState().goalRunsDraft).toEqual([
        expect.objectContaining({ id: 'run-1', agentId: 'agent-12', outcome }),
      ]);
    }
  );

  // Discarding ends the run for good: its goal run closes as killed. A
  // discard the backend could not record keeps the agent listed.
  it('closes the goal run of a discarded agent, and keeps it listed when that failed', async () => {
    const { discardInterruptedAgent } = await import('../tauri/agents');
    const interrupted = {
      id: 'agent-2',
      name: 'Worker',
      model: 'gpt',
      provider: 'codex',
      task: 'work',
      dangerouslyIgnorePermissions: false,
      autoAcceptEdits: false,
      headless: false,
      startedAt: 1,
    };
    const running = {
      id: 'run-1',
      goalId: 'g1',
      agentId: 'agent-2',
      ticketId: null,
      prompt: 'work',
      model: 'gpt',
      provider: 'codex',
      source: 'ui' as const,
      outcome: 'running' as const,
      summary: '',
      startedAt: '2026-09-27 01:00:00',
      finishedAt: null,
    };
    store.setState({ interruptedAgents: [interrupted], goalRunsDraft: [running] });

    vi.mocked(discardInterruptedAgent).mockRejectedValueOnce('disk I/O error');
    await store.getState().discardInterruptedAgent('agent-2');
    expect(store.getState().interruptedAgents).toHaveLength(1);
    expect(store.getState().goalRunsDraft[0].outcome).toBe('running');

    await store.getState().discardInterruptedAgent('agent-2');
    expect(store.getState().interruptedAgents).toEqual([]);
    expect(store.getState().goalRunsDraft[0].outcome).toBe('killed');
  });

  // Review r2: no fixed cap on stops waiting for their agent; every one of a
  // burst of short runs ends.
  it('keeps every early exit of a burst of 60 short runs', async () => {
    const { spawnAgent } = await import('../tauri/agents');
    const real = vi.mocked(spawnAgent).getMockImplementation()!;
    let next = 100;
    vi.mocked(spawnAgent).mockImplementation(async (config) => {
      const id = `agent-${next++}`;
      await Promise.resolve();
      store.getState().updateAgentStatus(id, 'idle');
      return {
        id,
        name: config.name,
        model: config.model,
        provider: 'codex',
        status: 'running',
        currentTask: config.task,
        startedAt: 1,
      };
    });

    await Promise.all(Array.from({ length: 60 }, () => spawn({ spawnedByGoalId: undefined })));
    vi.mocked(spawnAgent).mockImplementation(real);

    const agents = store.getState().agents;
    expect(agents.filter((agent) => agent.status === 'running')).toEqual([]);
  });

  // Fault injection: the first write of the summary fails.
  it('retries the finish record until it lands', async () => {
    vi.useFakeTimers();
    try {
      recordLaunchRun.mockRejectedValueOnce(new Error('inbox unavailable'));
      await spawn();
      store.getState().updateAgentStatus('agent-7', 'idle');
      await vi.advanceTimersByTimeAsync(10_000);

      expect(recordLaunchRun).toHaveBeenCalledTimes(2);
      expect(recordLaunchRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ requestUid: 'req-1', status: 'completed' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a natural finish with a summary from the output', async () => {
    await spawn();
    store.setState({
      agentLogs: { 'agent-7': ['Done. All 12 tests pass and the PR is ready.\n'] },
    });
    store.getState().updateAgentStatus('agent-7', 'idle');

    expect(recordLaunchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestUid: 'req-1',
        status: 'completed',
        summary: expect.stringContaining('12 tests'),
      })
    );
  });

  // Review r2: the store's view of the end (idle for a killed agent) must not
  // decide the run's status; the backend's verdict does.
  it('sends the summary only, never a status of its own', async () => {
    await spawn();
    store.getState().updateAgentStatus('agent-7', 'idle');

    expect(recordLaunchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestUid: 'req-1', summaryOnly: true })
    );
  });

  it('records a crash as failed', async () => {
    await spawn();
    store.getState().updateAgentStatus('agent-7', 'error');

    expect(recordLaunchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestUid: 'req-1', status: 'failed' })
    );
  });

  it('records a kill', async () => {
    await spawn();
    await store.getState().killRunningAgent('agent-7');

    expect(recordLaunchRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestUid: 'req-1', status: 'killed' })
    );
  });

  it('records nothing for an agent that did not come from a request', async () => {
    await spawn({ launchRequestUid: undefined });
    store.getState().updateAgentStatus('agent-7', 'idle');

    expect(recordLaunchRun).not.toHaveBeenCalled();
  });

  // Fault injection: the inbox database is unreachable (browser mode, lock).
  it('still starts and tracks the agent when recording fails', async () => {
    recordLaunchRun.mockRejectedValueOnce(new Error('database is locked'));
    await spawn();

    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().goalRunsDraft).toHaveLength(1);
  });
});

/**
 * Review r1: the goal binding of a started request must survive a restart
 * without a manual save, and persisting it must not overwrite goals that MCP
 * agents changed in the meantime (only the run row is written).
 */
describe('the goal run of a launch request is stored at once', () => {
  let store: StoreApi<StoreState>;
  const saved = new Map<string, PmGoalRun>();

  beforeEach(() => {
    vi.clearAllMocks();
    saved.clear();
    vi.mocked(goalsSave).mockImplementation(async (_path, payload) => {
      for (const run of payload.goalRuns) saved.set(run.id, run);
      return { conflicts: [] };
    });
    // @ts-expect-error - Partial store for testing (only agent+goals slices)
    store = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createGoalsSlice(...a),
    }));
    store.setState({ goalsDraft: [goal()], rootPath: '/repo' } as never);
  });

  const spawn = (extra: Record<string, unknown> = {}) =>
    store.getState().spawnNewAgent({
      name: 'Worker',
      model: 'gpt',
      task: 'work on g1',
      provider: 'codex',
      spawnedByGoalId: 'g1',
      launchRequestUid: 'req-1',
      ...extra,
    });

  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it('writes only the run row when the agent starts', async () => {
    await spawn();
    await settle();

    expect(goalsSave).toHaveBeenCalledTimes(1);
    const [path, payload] = vi.mocked(goalsSave).mock.calls[0];
    expect(path).toBe('/repo');
    expect(payload.goals).toEqual([]);
    expect(payload.requirementLinks).toEqual([]);
    expect(payload.stations).toEqual([]);
    expect(payload.deletedGoalIds).toEqual([]);
    expect(payload.deletedRunIds).toEqual([]);
    expect(payload.goalRuns).toEqual([
      expect.objectContaining({ goalId: 'g1', agentId: 'agent-7', outcome: 'running' }),
    ]);
  });

  it('keeps agent, goal, prompt and final outcome across a reload', async () => {
    await spawn();
    store.getState().updateAgentStatus('agent-7', 'idle');
    await settle();

    vi.mocked(goalsLoad).mockResolvedValueOnce({
      goals: [goal()],
      goalRuns: [...saved.values()],
      requirementLinks: [],
      stations: [],
      dependencies: [],
    });
    // @ts-expect-error - Partial store for testing (only agent+goals slices)
    const restarted = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createGoalsSlice(...a),
    }));
    await restarted.getState().loadGoals('/repo');

    expect(restarted.getState().goalRuns).toEqual([
      expect.objectContaining({
        goalId: 'g1',
        agentId: 'agent-7',
        prompt: 'work on g1',
        outcome: 'completed',
      }),
    ]);
  });

  it('leaves other unsaved goal edits as drafts', async () => {
    store.getState().updateGoal('g1', { name: 'Renamed locally' });
    await spawn();
    await settle();

    expect(store.getState().goalsDirty).toBe(true);
    expect(vi.mocked(goalsSave).mock.calls[0][1].goals).toEqual([]);
  });

  it('writes nothing extra for an agent that did not come from a request', async () => {
    await spawn({ launchRequestUid: undefined });
    await settle();

    expect(goalsSave).not.toHaveBeenCalled();
  });

  // Fault injection: the project database is unreachable.
  it('still runs and keeps the run as a draft when writing fails', async () => {
    vi.mocked(goalsSave).mockRejectedValue(new Error('database is locked'));
    await spawn();
    await settle();

    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().goalRunsDraft).toHaveLength(1);
    expect(store.getState().goalsDirty).toBe(true);
  });
});

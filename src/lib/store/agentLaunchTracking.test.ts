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

  it('records the running agent against its request', async () => {
    await spawn();

    expect(recordLaunchRun).toHaveBeenCalledWith({
      requestUid: 'req-1',
      agentId: 'agent-7',
      agentName: 'Worker',
      provider: 'codex',
      model: 'gpt',
      status: 'running',
    });
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

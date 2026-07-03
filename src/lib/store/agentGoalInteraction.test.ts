import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import { createGoalsSlice } from './goalsSlice';
import type { StoreState } from './index';
import type { PmGoal } from '../tauri/goals';

vi.mock('../tauri/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawnAgent: vi.fn(async (config: any) => ({
    id: 'mock-agent-1',
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

vi.mock('../tauri/db', () => ({
  initProjectDb: vi.fn(async () => undefined),
}));

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
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

describe('Agent and Goal Interaction', () => {
  let store: StoreApi<StoreState>;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - Partial store for testing (only agent+goals slices)
    store = createStore<StoreState>()((...a) => ({
      ...createAgentSlice(...a),
      ...createGoalsSlice(...a),
    }));
  });

  async function spawnForGoal() {
    store.setState({ goalsDraft: [makeGoal()] });
    await store.getState().spawnNewAgent({
      name: 'Agent',
      model: 'sonnet',
      task: 'Achieve goal g1: do the thing',
      provider: 'claude',
      spawnedByGoalId: 'g1',
    });
  }

  it('records a goal run with the exact prompt when spawning for a goal', async () => {
    await spawnForGoal();

    const runs = store.getState().goalRunsDraft;
    expect(runs).toHaveLength(1);
    expect(runs[0].goalId).toBe('g1');
    expect(runs[0].agentId).toBe('mock-agent-1');
    expect(runs[0].prompt).toBe('Achieve goal g1: do the thing');
    expect(runs[0].model).toBe('sonnet');
    expect(runs[0].outcome).toBe('running');
    // Launching flips the goal into in_progress
    expect(store.getState().goalsDraft[0].status).toBe('in_progress');
  });

  it('does not record a run for agents without a goal', async () => {
    await store.getState().spawnNewAgent({ name: 'A', model: 'm', task: 't' });
    expect(store.getState().goalRunsDraft).toHaveLength(0);
  });

  it('completes the run as killed when the agent is killed', async () => {
    await spawnForGoal();
    await store.getState().killRunningAgent('mock-agent-1');

    const run = store.getState().goalRunsDraft[0];
    expect(run.outcome).toBe('killed');
    expect(run.finishedAt).not.toBeNull();
  });

  it('completes the run as completed when the agent finishes naturally', async () => {
    await spawnForGoal();
    store.getState().updateAgentStatus('mock-agent-1', 'idle');

    expect(store.getState().goalRunsDraft[0].outcome).toBe('completed');
  });

  it('completes the run as failed when the agent errors', async () => {
    await spawnForGoal();
    store.getState().updateAgentStatus('mock-agent-1', 'error');

    expect(store.getState().goalRunsDraft[0].outcome).toBe('failed');
  });
});

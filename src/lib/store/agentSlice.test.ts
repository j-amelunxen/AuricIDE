import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AgentSlice } from './agentSlice';
import {
  createAgentSlice,
  groupAgentsByRepo,
  MAX_AGENT_LOGS,
  MAX_AGENT_LOG_BYTES,
  MAX_FINISHED_AGENTS,
} from './agentSlice';

vi.mock('../tauri/agents', () => ({
  spawnAgent: vi.fn(async (config: { name: string; model: string; task: string }) => ({
    id: 'mock-agent-1',
    name: config.name,
    model: config.model,
    provider: 'claude',
    status: 'running' as const,
    currentTask: config.task,
    startedAt: 1000,
  })),
  killAgent: vi.fn(async () => undefined),
  killAgentsForRepo: vi.fn(async () => 2),
  listAgents: vi.fn(async () => [
    {
      id: 'agent-remote-1',
      name: 'Remote Agent',
      model: 'claude-opus-4-6',
      provider: 'claude',
      status: 'idle' as const,
      startedAt: 2000,
    },
  ]),
}));

describe('agentSlice', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('initializes with empty agents array and empty logs', () => {
    const state = store.getState();
    expect(state.agents).toEqual([]);
    expect(state.agentLogs).toEqual({});
  });

  it('spawnNewAgent adds agent to list', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    const state = store.getState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].id).toBe('mock-agent-1');
    expect(state.agents[0].name).toBe('Writer');
    expect(state.agents[0].status).toBe('running');
  });

  it('killRunningAgent removes agent from list', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    expect(store.getState().agents).toHaveLength(1);

    await store.getState().killRunningAgent('mock-agent-1');
    expect(store.getState().agents).toHaveLength(0);
  });

  it('killRunningAgent calls killAgent IPC', async () => {
    const { killAgent } = await import('../tauri/agents');
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    await store.getState().killRunningAgent('mock-agent-1');
    expect(killAgent).toHaveBeenCalledWith('mock-agent-1');
  });

  it('updateAgentStatus changes the status of an agent', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    store.getState().updateAgentStatus('mock-agent-1', 'idle');
    expect(store.getState().agents[0].status).toBe('idle');
  });

  it('updateAgentStatus is a no-op for unknown agent id', () => {
    store.getState().updateAgentStatus('nonexistent', 'error');
    expect(store.getState().agents).toEqual([]);
  });

  it('appendAgentLog adds log entry for agent', () => {
    store.getState().appendAgentLog('agent-1', 'First log');
    store.getState().appendAgentLog('agent-1', 'Second log');

    expect(store.getState().agentLogs['agent-1']).toEqual(['First log', 'Second log']);
  });

  it('appendAgentLog creates new log array for new agent', () => {
    store.getState().appendAgentLog('agent-new', 'Hello');
    expect(store.getState().agentLogs['agent-new']).toEqual(['Hello']);
  });

  it('refreshAgents fetches agents from IPC', async () => {
    await store.getState().refreshAgents();

    const state = store.getState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].id).toBe('agent-remote-1');
    expect(state.agents[0].name).toBe('Remote Agent');
  });

  it('initializes selectedAgentId as null', () => {
    expect(store.getState().selectedAgentId).toBeNull();
  });

  it('selectAgent sets selectedAgentId', () => {
    store.getState().selectAgent('agent-1');
    expect(store.getState().selectedAgentId).toBe('agent-1');
  });

  it('selectAgent(null) clears selection', () => {
    store.getState().selectAgent('agent-1');
    store.getState().selectAgent(null);
    expect(store.getState().selectedAgentId).toBeNull();
  });

  it('killAgentsForRepoPath removes agents with matching repoPath', async () => {
    // Manually set agents with repoPath
    store.setState({
      agents: [
        {
          id: '1',
          name: 'A',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 0,
          repoPath: '/repo-a',
        },
        {
          id: '2',
          name: 'B',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 0,
          repoPath: '/repo-b',
        },
        {
          id: '3',
          name: 'C',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 0,
          repoPath: '/repo-a',
        },
      ],
    });
    await store.getState().killAgentsForRepoPath('/repo-a');
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0].id).toBe('2');
  });

  it('killAgentsForRepoPath drops logs and metadata of killed agents', async () => {
    store.setState({
      agents: [
        {
          id: '1',
          name: 'A',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 0,
          repoPath: '/repo-a',
        },
        {
          id: '2',
          name: 'B',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 0,
          repoPath: '/repo-b',
        },
      ],
    });
    store.getState().appendAgentLog('1', 'a-log');
    store.getState().appendAgentLog('2', 'b-log');

    await store.getState().killAgentsForRepoPath('/repo-a');

    expect(store.getState().agentLogs['1']).toBeUndefined();
    expect(store.getState().agentLogMeta['1']).toBeUndefined();
    expect(store.getState().agentLogs['2']).toEqual(['b-log']);
    expect(store.getState().agentLogMeta['2']).toBeDefined();
  });
});

describe('groupAgentsByRepo', () => {
  it('groups agents by repoPath', () => {
    const agents = [
      {
        id: '1',
        name: 'A',
        model: 'm',
        provider: 'claude',
        status: 'running' as const,
        startedAt: 0,
        repoPath: '/repo-a',
      },
      {
        id: '2',
        name: 'B',
        model: 'm',
        provider: 'claude',
        status: 'running' as const,
        startedAt: 0,
        repoPath: '/repo-b',
      },
      {
        id: '3',
        name: 'C',
        model: 'm',
        provider: 'claude',
        status: 'running' as const,
        startedAt: 0,
        repoPath: '/repo-a',
      },
    ];
    const groups = groupAgentsByRepo(agents);
    expect(groups['/repo-a']).toHaveLength(2);
    expect(groups['/repo-b']).toHaveLength(1);
  });

  it('uses "Unknown" for agents without repoPath', () => {
    const agents = [
      {
        id: '1',
        name: 'A',
        model: 'm',
        provider: 'claude',
        status: 'running' as const,
        startedAt: 0,
      },
    ];
    const groups = groupAgentsByRepo(agents);
    expect(groups['Unknown']).toHaveLength(1);
  });
});

describe('agentSlice – agent logs buffer cap', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('caps agent logs at MAX_AGENT_LOGS per agent', () => {
    const total = MAX_AGENT_LOGS + 200;
    for (let i = 0; i < total; i++) {
      store.getState().appendAgentLog('agent-1', `log-${i}`);
    }
    const logs = store.getState().agentLogs['agent-1'];
    expect(logs).toHaveLength(MAX_AGENT_LOGS);
    // The oldest 200 entries should be dropped
    expect(logs[0]).toBe('log-200');
    expect(logs[MAX_AGENT_LOGS - 1]).toBe(`log-${total - 1}`);
  });

  it('preserves logs when under the limit', () => {
    store.getState().appendAgentLog('agent-1', 'first');
    store.getState().appendAgentLog('agent-1', 'second');
    store.getState().appendAgentLog('agent-1', 'third');

    const logs = store.getState().agentLogs['agent-1'];
    expect(logs).toHaveLength(3);
    expect(logs[0]).toBe('first');
    expect(logs[2]).toBe('third');
  });

  it('different agents have independent caps', () => {
    const total = MAX_AGENT_LOGS + 50;
    for (let i = 0; i < total; i++) {
      store.getState().appendAgentLog('agent-1', `a1-log-${i}`);
    }
    // Add just a few to agent-2
    store.getState().appendAgentLog('agent-2', 'a2-first');
    store.getState().appendAgentLog('agent-2', 'a2-second');

    expect(store.getState().agentLogs['agent-1']).toHaveLength(MAX_AGENT_LOGS);
    expect(store.getState().agentLogs['agent-2']).toHaveLength(2);
    expect(store.getState().agentLogs['agent-2'][0]).toBe('a2-first');
  });
});

describe('agentSlice – byte-bounded agent logs', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('trims oldest chunks once MAX_AGENT_LOG_BYTES is exceeded', () => {
    // Five chunks of ~1/3 the cap → only the newest chunks that fit remain
    const chunkSize = Math.ceil(MAX_AGENT_LOG_BYTES / 3);
    for (let i = 0; i < 5; i++) {
      store.getState().appendAgentLog('agent-1', `${i}`.padEnd(chunkSize, 'x'));
    }
    const logs = store.getState().agentLogs['agent-1'];
    const totalBytes = logs.reduce((sum, l) => sum + l.length, 0);
    expect(totalBytes).toBeLessThanOrEqual(MAX_AGENT_LOG_BYTES);
    // Newest chunk is always last, oldest chunks were dropped
    expect(logs[logs.length - 1].startsWith('4')).toBe(true);
    expect(logs[0].startsWith('0')).toBe(false);
  });

  it('keeps the newest chunk even when it alone exceeds the cap', () => {
    store.getState().appendAgentLog('agent-1', 'small');
    store.getState().appendAgentLog('agent-1', 'y'.repeat(MAX_AGENT_LOG_BYTES + 10));
    const logs = store.getState().agentLogs['agent-1'];
    expect(logs).toHaveLength(1);
    expect(logs[0].startsWith('y')).toBe(true);
  });

  it('tracks a monotonically increasing seq across trims', () => {
    const chunkSize = Math.ceil(MAX_AGENT_LOG_BYTES / 2);
    for (let i = 0; i < 6; i++) {
      store.getState().appendAgentLog('agent-1', 'x'.repeat(chunkSize));
    }
    expect(store.getState().agentLogMeta['agent-1'].seq).toBe(6);
    expect(store.getState().agentLogs['agent-1'].length).toBeLessThan(6);
  });

  it('tracks retained byte size per agent', () => {
    store.getState().appendAgentLog('agent-1', 'abcd');
    store.getState().appendAgentLog('agent-1', 'ef');
    expect(store.getState().agentLogMeta['agent-1'].bytes).toBe(6);
  });

  it('killRunningAgent clears log metadata for the killed agent', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    store.getState().appendAgentLog('mock-agent-1', 'log');
    store.getState().appendAgentLog('other-agent', 'other');

    await store.getState().killRunningAgent('mock-agent-1');
    expect(store.getState().agentLogMeta['mock-agent-1']).toBeUndefined();
    expect(store.getState().agentLogMeta['other-agent']).toBeDefined();
  });

  it('finished-agent eviction clears log metadata of evicted agents', () => {
    const agents = Array.from({ length: MAX_FINISHED_AGENTS }, (_, i) => ({
      id: `agent-${i}`,
      name: `agent-${i}`,
      model: 'm',
      provider: 'claude',
      status: 'idle' as const,
      startedAt: i,
    }));
    store.setState({
      agents: [
        ...agents,
        {
          id: 'agent-new',
          name: 'new',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 1000,
        },
      ],
    });
    for (const a of agents) store.getState().appendAgentLog(a.id, `log for ${a.id}`);

    store.getState().updateAgentStatus('agent-new', 'idle');

    expect(store.getState().agentLogMeta['agent-0']).toBeUndefined();
    expect(store.getState().agentLogMeta[`agent-${MAX_FINISHED_AGENTS - 1}`]).toBeDefined();
  });
});

describe('agentSlice – killRunningAgent graceful handling', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('cleans up frontend state even when Rust-side kill throws "not found"', async () => {
    const { killAgent } = await import('../tauri/agents');
    vi.mocked(killAgent).mockRejectedValueOnce(new Error('Agent not found: mock-agent-1'));

    // Simulate an agent that terminated naturally (Rust already cleaned up)
    store.setState({
      agents: [
        {
          id: 'mock-agent-1',
          name: 'Done Agent',
          model: 'm',
          provider: 'claude',
          status: 'idle' as const,
          startedAt: 0,
        },
      ],
      agentLogs: { 'mock-agent-1': ['some output'] },
    });

    // Should NOT throw — frontend cleanup still happens
    await store.getState().killRunningAgent('mock-agent-1');

    expect(store.getState().agents).toHaveLength(0);
    expect(store.getState().agentLogs['mock-agent-1']).toBeUndefined();
  });

  it('agent with idle status remains visible until explicitly dismissed', () => {
    store.setState({
      agents: [
        {
          id: 'idle-agent',
          name: 'Idle Agent',
          model: 'm',
          provider: 'claude',
          status: 'idle' as const,
          startedAt: 0,
        },
      ],
    });

    // Agent should still be in the list
    expect(store.getState().agents).toHaveLength(1);
    expect(store.getState().agents[0].status).toBe('idle');
  });
});

describe('agentSlice – killRunningAgent cleans up logs', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('killRunningAgent removes agent logs for the killed agent', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    store.getState().appendAgentLog('mock-agent-1', 'some log');
    store.getState().appendAgentLog('mock-agent-1', 'another log');
    expect(store.getState().agentLogs['mock-agent-1']).toHaveLength(2);

    await store.getState().killRunningAgent('mock-agent-1');
    expect(store.getState().agentLogs['mock-agent-1']).toBeUndefined();
  });

  it('killRunningAgent preserves logs for other agents', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    store.getState().appendAgentLog('mock-agent-1', 'agent-1 log');
    store.getState().appendAgentLog('other-agent', 'other log');

    await store.getState().killRunningAgent('mock-agent-1');
    expect(store.getState().agentLogs['mock-agent-1']).toBeUndefined();
    expect(store.getState().agentLogs['other-agent']).toEqual(['other log']);
  });
});

describe('agentSlice – bounded finished-agent retention', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  function finishedAgent(id: string, startedAt: number) {
    return {
      id,
      name: id,
      model: 'm',
      provider: 'claude',
      status: 'idle' as const,
      startedAt,
    };
  }

  it('evicts the oldest finished agents once MAX_FINISHED_AGENTS is exceeded', () => {
    const agents = Array.from({ length: MAX_FINISHED_AGENTS }, (_, i) =>
      finishedAgent(`agent-${i}`, i)
    );
    store.setState({
      agents: [
        ...agents,
        {
          id: 'agent-new',
          name: 'new',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 1000,
        },
      ],
      agentLogs: Object.fromEntries(agents.map((a) => [a.id, [`log for ${a.id}`]])),
    });

    // The new agent finishes, pushing the finished count past the cap
    store.getState().updateAgentStatus('agent-new', 'idle');

    const state = store.getState();
    expect(state.agents).toHaveLength(MAX_FINISHED_AGENTS);
    expect(state.agents.find((a) => a.id === 'agent-0')).toBeUndefined();
    expect(state.agentLogs['agent-0']).toBeUndefined();
    expect(state.agents.find((a) => a.id === 'agent-new')).toBeDefined();
    // Newer finished agents are kept
    expect(state.agents.find((a) => a.id === `agent-${MAX_FINISHED_AGENTS - 1}`)).toBeDefined();
  });

  it('never evicts running or queued agents to make room', () => {
    const finished = Array.from({ length: MAX_FINISHED_AGENTS }, (_, i) =>
      finishedAgent(`agent-${i}`, i)
    );
    const running = {
      id: 'running-agent',
      name: 'r',
      model: 'm',
      provider: 'claude',
      status: 'running' as const,
      startedAt: 0,
    };
    store.setState({ agents: [running, ...finished] });

    store.getState().updateAgentStatus('agent-0', 'error');

    expect(store.getState().agents.find((a) => a.id === 'running-agent')).toBeDefined();
  });

  it('keeps all finished agents when under the cap', () => {
    store.setState({
      agents: [finishedAgent('a', 0), finishedAgent('b', 1)],
    });
    store.getState().updateAgentStatus('a', 'idle');
    expect(store.getState().agents).toHaveLength(2);
  });
});

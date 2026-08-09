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
  recordAgentPromptHistory: vi.fn(async () => undefined),
  killAgentsForRepo: vi.fn(async () => 2),
  renameAgent: vi.fn(async () => undefined),
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
  listInterruptedAgents: vi.fn(async () => [
    {
      id: 'agent-9',
      name: 'Interrupted Agent',
      model: 'sonnet',
      provider: 'claude',
      task: 'refactor the parser',
      cwd: '/repo',
      permissionMode: 'auto',
      dangerouslyIgnorePermissions: false,
      autoAcceptEdits: false,
      headless: false,
      startedAt: 3000,
    },
  ]),
  resumeInterruptedAgent: vi.fn(async (agentId: string) => ({
    id: 'agent-10',
    name: 'Interrupted Agent',
    model: 'sonnet',
    provider: 'claude',
    status: 'running' as const,
    currentTask: `resumed:${agentId}`,
    startedAt: 4000,
    repoPath: '/repo',
  })),
  discardInterruptedAgent: vi.fn(async () => undefined),
  listAgentPromptHistory: vi.fn(async () => [
    { id: 'h1', prompt: 'newest', agentName: 'A', model: 'm', provider: 'claude', source: 'ui' },
    { id: 'h2', prompt: 'older', agentName: 'A', model: 'm', provider: 'claude', source: 'ui' },
  ]),
}));

describe('agentSlice', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('starts with an empty prompt history', () => {
    expect(store.getState().promptHistory).toEqual([]);
  });

  it('loadPromptHistory fills the history newest-first', async () => {
    await store.getState().loadPromptHistory('/repo');
    expect(store.getState().promptHistory).toEqual(['newest', 'older']);
  });

  it('loadPromptHistory drops blank prompts and duplicates', async () => {
    const agents = await import('../tauri/agents');
    vi.mocked(agents.listAgentPromptHistory).mockResolvedValueOnce([
      { id: 'h1', prompt: 'same', agentName: 'A', model: 'm', provider: 'c', source: 'ui' },
      { id: 'h2', prompt: '   ', agentName: 'A', model: 'm', provider: 'c', source: 'ui' },
      { id: 'h3', prompt: 'same', agentName: 'A', model: 'm', provider: 'c', source: 'ui' },
      { id: 'h4', prompt: 'other', agentName: 'A', model: 'm', provider: 'c', source: 'ui' },
    ]);
    await store.getState().loadPromptHistory('/repo');
    expect(store.getState().promptHistory).toEqual(['same', 'other']);
  });

  it('loadPromptHistory keeps the previous history when the backend fails', async () => {
    const agents = await import('../tauri/agents');
    await store.getState().loadPromptHistory('/repo');
    vi.mocked(agents.listAgentPromptHistory).mockRejectedValueOnce(new Error('no db'));
    await expect(store.getState().loadPromptHistory('/repo')).resolves.toBeUndefined();
    expect(store.getState().promptHistory).toEqual(['newest', 'older']);
  });

  it('loadPromptHistory clears the history without a project path', async () => {
    await store.getState().loadPromptHistory('/repo');
    await store.getState().loadPromptHistory('');
    expect(store.getState().promptHistory).toEqual([]);
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

  it('stamps finishedAt when the agent stops', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    const before = Date.now();
    store.getState().updateAgentStatus('mock-agent-1', 'idle');
    const finishedAt = store.getState().agents[0].finishedAt;
    expect(finishedAt).toBeGreaterThanOrEqual(before);
    expect(finishedAt).toBeLessThanOrEqual(Date.now());
  });

  it('does not restamp finishedAt on a repeated stop signal', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    store.getState().updateAgentStatus('mock-agent-1', 'idle');
    const first = store.getState().agents[0].finishedAt;
    store.getState().updateAgentStatus('mock-agent-1', 'error');
    // The first stop is when it stopped; a late duplicate event must not
    // shuffle the review order.
    expect(store.getState().agents[0].finishedAt).toBe(first);
  });

  it('leaves finishedAt unset while the agent runs', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    expect(store.getState().agents[0].finishedAt).toBeUndefined();
  });

  it('retries a failed agent with its original launch config', async () => {
    const { spawnAgent } = await import('../tauri/agents');
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
      permissionMode: 'acceptEdits',
    });
    store.getState().updateAgentStatus('mock-agent-1', 'error');

    vi.mocked(spawnAgent).mockResolvedValueOnce({
      id: 'mock-agent-2',
      name: 'Writer',
      model: 'claude-opus-4-6',
      provider: 'claude',
      status: 'running',
      currentTask: 'Write docs',
      startedAt: 2000,
    });
    const replacement = await store.getState().retryFailedAgent('mock-agent-1');

    // The exact config again — permission mode included, not a downgraded
    // reconstruction from the agent's display fields.
    expect(spawnAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ task: 'Write docs', permissionMode: 'acceptEdits' })
    );
    expect(replacement?.id).toBe('mock-agent-2');
    // The failed run is answered by its retry — it leaves the review pile.
    expect(store.getState().agents.map((a) => a.id)).toEqual(['mock-agent-2']);
  });

  it('refuses to retry an agent that is not in error', async () => {
    const { spawnAgent } = await import('../tauri/agents');
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    vi.mocked(spawnAgent).mockClear();

    expect(await store.getState().retryFailedAgent('mock-agent-1')).toBeNull();
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('marks a finished agent reviewed when its logs are opened', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    store.getState().updateAgentStatus('mock-agent-1', 'idle');

    store.getState().selectAgent('mock-agent-1');
    expect(store.getState().reviewedAgentIds).toContain('mock-agent-1');
  });

  it('does not mark a still-running agent reviewed', async () => {
    // Peeking at a running agent is not reviewing its outcome — there is no
    // outcome yet. The unseen marker must survive until the result was seen.
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    store.getState().selectAgent('mock-agent-1');
    expect(store.getState().reviewedAgentIds).not.toContain('mock-agent-1');
  });

  it('forgets the reviewed mark when the agent is dismissed', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    store.getState().updateAgentStatus('mock-agent-1', 'idle');
    store.getState().selectAgent('mock-agent-1');

    store.getState().dismissFinishedAgent('mock-agent-1');
    expect(store.getState().reviewedAgentIds).not.toContain('mock-agent-1');
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

describe('agentSlice – interrupted agents (restart persistence)', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('initializes interruptedAgents as empty array', () => {
    expect(store.getState().interruptedAgents).toEqual([]);
  });

  it('loadInterruptedAgents fetches interrupted agents from IPC', async () => {
    await store.getState().loadInterruptedAgents();

    const state = store.getState();
    expect(state.interruptedAgents).toHaveLength(1);
    expect(state.interruptedAgents[0].id).toBe('agent-9');
    expect(state.interruptedAgents[0].task).toBe('refactor the parser');
  });

  it('loadInterruptedAgents swallows IPC errors (browser mode)', async () => {
    const { listInterruptedAgents } = await import('../tauri/agents');
    vi.mocked(listInterruptedAgents).mockRejectedValueOnce(new Error('no tauri'));

    await store.getState().loadInterruptedAgents();
    expect(store.getState().interruptedAgents).toEqual([]);
  });

  it('resumeInterruptedAgent moves the agent from interrupted to active and selects it', async () => {
    await store.getState().loadInterruptedAgents();

    await store.getState().resumeInterruptedAgent('agent-9');

    const state = store.getState();
    expect(state.interruptedAgents).toEqual([]);
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].id).toBe('agent-10');
    expect(state.agents[0].status).toBe('running');
    expect(state.selectedAgentId).toBe('agent-10');
  });

  it('resumeInterruptedAgent calls the IPC with the agent id', async () => {
    const { resumeInterruptedAgent } = await import('../tauri/agents');
    await store.getState().loadInterruptedAgents();

    await store.getState().resumeInterruptedAgent('agent-9');
    expect(resumeInterruptedAgent).toHaveBeenCalledWith('agent-9');
  });

  it('resumeInterruptedAgent keeps the interrupted entry when the IPC fails', async () => {
    const { resumeInterruptedAgent } = await import('../tauri/agents');
    vi.mocked(resumeInterruptedAgent).mockRejectedValueOnce(new Error('spawn failed'));
    await store.getState().loadInterruptedAgents();

    await expect(store.getState().resumeInterruptedAgent('agent-9')).rejects.toThrow(
      'spawn failed'
    );
    expect(store.getState().interruptedAgents).toHaveLength(1);
    expect(store.getState().agents).toHaveLength(0);
  });

  it('discardInterruptedAgent removes the agent and calls the IPC', async () => {
    const { discardInterruptedAgent } = await import('../tauri/agents');
    await store.getState().loadInterruptedAgents();

    await store.getState().discardInterruptedAgent('agent-9');

    expect(store.getState().interruptedAgents).toEqual([]);
    expect(discardInterruptedAgent).toHaveBeenCalledWith('agent-9');
  });

  it('discardInterruptedAgent removes locally even when the IPC fails', async () => {
    const { discardInterruptedAgent } = await import('../tauri/agents');
    vi.mocked(discardInterruptedAgent).mockRejectedValueOnce(new Error('not found'));
    await store.getState().loadInterruptedAgents();

    await store.getState().discardInterruptedAgent('agent-9');
    expect(store.getState().interruptedAgents).toEqual([]);
  });
});

describe('agentSlice – spawn prompt history', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('records the start prompt in the project DB history on spawn', async () => {
    const { recordAgentPromptHistory } = await import('../tauri/agents');
    store.setState({ rootPath: '/my/project' } as Partial<AgentSlice>);

    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
      cwd: '/repo',
      runSource: 'conductor',
    });

    expect(recordAgentPromptHistory).toHaveBeenCalledWith('/my/project', {
      id: expect.any(String),
      prompt: 'Write docs',
      agentName: 'Writer',
      model: 'claude-opus-4-6',
      provider: 'claude',
      cwd: '/repo',
      source: 'conductor',
    });
  });

  it('skips history when no project is open', async () => {
    const { recordAgentPromptHistory } = await import('../tauri/agents');

    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    expect(recordAgentPromptHistory).not.toHaveBeenCalled();
  });

  it('spawn succeeds even when recording history fails', async () => {
    const { recordAgentPromptHistory } = await import('../tauri/agents');
    vi.mocked(recordAgentPromptHistory).mockRejectedValueOnce(new Error('db closed'));
    store.setState({ rootPath: '/my/project' } as Partial<AgentSlice>);

    const agent = await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    expect(agent.id).toBe('mock-agent-1');
    expect(store.getState().agents).toHaveLength(1);
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

describe('agentSlice – minimized agents', () => {
  let store: StoreApi<AgentSlice>;

  const agent = (id: string) => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status: 'running' as const,
    startedAt: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('starts with nothing minimized', () => {
    expect(store.getState().minimizedAgentIds).toEqual([]);
  });

  it('minimizes and restores an agent', () => {
    store.getState().setAgentMinimized('a1', true);
    expect(store.getState().minimizedAgentIds).toEqual(['a1']);

    store.getState().setAgentMinimized('a1', false);
    expect(store.getState().minimizedAgentIds).toEqual([]);
  });

  it('minimizing twice does not duplicate the entry', () => {
    store.getState().setAgentMinimized('a1', true);
    store.getState().setAgentMinimized('a1', true);
    expect(store.getState().minimizedAgentIds).toEqual(['a1']);
  });

  it('keeps a minimized agent in the fleet — parking is not stopping', () => {
    store.setState({ agents: [agent('a1'), agent('a2')] });
    store.getState().setAgentMinimized('a1', true);
    expect(store.getState().agents).toHaveLength(2);
  });

  it('forgets the minimized flag once the agent is killed', async () => {
    store.setState({ agents: [agent('a1')] });
    store.getState().setAgentMinimized('a1', true);

    await store.getState().killRunningAgent('a1');

    expect(store.getState().minimizedAgentIds).toEqual([]);
  });

  it('forgets minimized flags when a whole repo is stopped', async () => {
    store.setState({
      agents: [
        { ...agent('a1'), repoPath: '/repo' },
        { ...agent('a2'), repoPath: '/other' },
      ],
    });
    store.getState().setAgentMinimized('a1', true);
    store.getState().setAgentMinimized('a2', true);

    await store.getState().killAgentsForRepoPath('/repo');

    expect(store.getState().minimizedAgentIds).toEqual(['a2']);
  });

  it('forgets minimized flags for agents evicted by the retention cap', () => {
    const finished = Array.from({ length: MAX_FINISHED_AGENTS + 1 }, (_, i) => ({
      ...agent(`agent-${i}`),
      status: 'idle' as const,
      startedAt: i,
    }));
    store.setState({ agents: finished });
    store.getState().setAgentMinimized('agent-0', true);

    // Pushes the finished count past the cap, evicting the oldest (agent-0).
    store.getState().updateAgentStatus('agent-1', 'idle');

    expect(store.getState().agents.find((a) => a.id === 'agent-0')).toBeUndefined();
    expect(store.getState().minimizedAgentIds).toEqual([]);
  });
});

describe('agentSlice – renaming agents', () => {
  let store: StoreApi<AgentSlice>;

  const agent = (id: string, name: string) => ({
    id,
    name,
    model: 'm',
    provider: 'claude',
    status: 'running' as const,
    startedAt: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
    store.setState({ agents: [agent('a1', 'Agent (repo)'), agent('a2', 'Agent (repo)')] });
  });

  it('renames only the agent asked for', async () => {
    await store.getState().renameRunningAgent('a1', 'Docs sweep');
    expect(store.getState().agents.map((a) => a.name)).toEqual(['Docs sweep', 'Agent (repo)']);
  });

  it('trims the name before storing it', async () => {
    await store.getState().renameRunningAgent('a1', '  Docs sweep  ');
    expect(store.getState().agents[0].name).toBe('Docs sweep');
  });

  it('ignores a blank name rather than leaving a nameless agent', async () => {
    const agents = await import('../tauri/agents');
    await store.getState().renameRunningAgent('a1', '   ');
    expect(store.getState().agents[0].name).toBe('Agent (repo)');
    expect(agents.renameAgent).not.toHaveBeenCalled();
  });

  it('keeps the new name when the backend is unavailable', async () => {
    const agents = await import('../tauri/agents');
    vi.mocked(agents.renameAgent).mockRejectedValueOnce(new Error('no backend'));

    // Browser mode has no Rust side; the rename is still worth honouring locally.
    await expect(store.getState().renameRunningAgent('a1', 'Docs sweep')).resolves.toBeUndefined();
    expect(store.getState().agents[0].name).toBe('Docs sweep');
  });
});

describe('agentSlice – distinguishable names on spawn', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('keeps the name it was given when nothing clashes', async () => {
    const agent = await store
      .getState()
      .spawnNewAgent({ name: 'Fix the redirect', model: 'm', task: 't' });
    expect(agent.name).toBe('Fix the redirect');
  });

  it('numbers a second agent started from the same instruction', async () => {
    store.setState({
      agents: [
        {
          id: 'existing',
          name: 'Fix the redirect',
          model: 'm',
          provider: 'claude',
          status: 'running',
          startedAt: 0,
        },
      ],
    });

    const agent = await store
      .getState()
      .spawnNewAgent({ name: 'Fix the redirect', model: 'm', task: 't' });

    expect(agent.name).toBe('Fix the redirect 2');
    expect(store.getState().agents.map((a) => a.name)).toEqual([
      'Fix the redirect',
      'Fix the redirect 2',
    ]);
  });

  it('tells the backend about the disambiguated name', async () => {
    const agents = await import('../tauri/agents');
    store.setState({
      agents: [
        {
          id: 'existing',
          name: 'Fix the redirect',
          model: 'm',
          provider: 'claude',
          status: 'running',
          startedAt: 0,
        },
      ],
    });

    await store.getState().spawnNewAgent({ name: 'Fix the redirect', model: 'm', task: 't' });

    expect(agents.renameAgent).toHaveBeenCalledWith('mock-agent-1', 'Fix the redirect 2');
  });

  it('still spawns when the rename call itself blows up', async () => {
    const agents = await import('../tauri/agents');
    vi.mocked(agents.renameAgent).mockImplementationOnce(() => {
      throw new Error('no such command');
    });
    store.setState({
      agents: [
        {
          id: 'existing',
          name: 'Fix the redirect',
          model: 'm',
          provider: 'claude',
          status: 'running',
          startedAt: 0,
        },
      ],
    });

    // A label is cosmetic; losing it must never cost the agent.
    const agent = await store
      .getState()
      .spawnNewAgent({ name: 'Fix the redirect', model: 'm', task: 't' });

    expect(agent.name).toBe('Fix the redirect 2');
    expect(store.getState().agents).toHaveLength(2);
  });

  it('does not call the backend when no disambiguation was needed', async () => {
    const agents = await import('../tauri/agents');
    await store.getState().spawnNewAgent({ name: 'Fix the redirect', model: 'm', task: 't' });
    expect(agents.renameAgent).not.toHaveBeenCalled();
  });
});

describe('agentSlice – marker colours', () => {
  let store: StoreApi<AgentSlice>;

  const withStatus = (id: string, status: 'running' | 'idle' = 'running') => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status,
    startedAt: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
    store.setState({ agents: [withStatus('a1'), withStatus('a2')] });
  });

  it('starts with no agent marked', () => {
    expect(store.getState().agentColors).toEqual({});
  });

  it('marks one agent without touching the others', () => {
    store.getState().setAgentColor('a1', 'red');
    expect(store.getState().agentColors).toEqual({ a1: 'red' });
  });

  it('changes a marker', () => {
    store.getState().setAgentColor('a1', 'red');
    store.getState().setAgentColor('a1', 'blue');
    expect(store.getState().agentColors.a1).toBe('blue');
  });

  it('clears a marker', () => {
    store.getState().setAgentColor('a1', 'red');
    store.getState().setAgentColor('a1', null);
    expect(store.getState().agentColors).toEqual({});
  });

  it('lets several agents share a colour — that is how grouping works', () => {
    store.getState().setAgentColor('a1', 'green');
    store.getState().setAgentColor('a2', 'green');
    expect(store.getState().agentColors).toEqual({ a1: 'green', a2: 'green' });
  });

  it('forgets the marker once the agent is killed', async () => {
    store.getState().setAgentColor('a1', 'red');
    await store.getState().killRunningAgent('a1');
    expect(store.getState().agentColors).toEqual({});
  });

  it('forgets markers when a whole repo is stopped', async () => {
    store.setState({
      agents: [
        { ...withStatus('a1'), repoPath: '/repo' },
        { ...withStatus('a2'), repoPath: '/other' },
      ],
    });
    store.getState().setAgentColor('a1', 'red');
    store.getState().setAgentColor('a2', 'blue');

    await store.getState().killAgentsForRepoPath('/repo');

    expect(store.getState().agentColors).toEqual({ a2: 'blue' });
  });

  it('forgets the marker of a dismissed agent', () => {
    store.setState({ agents: [withStatus('done', 'idle')] });
    store.getState().setAgentColor('done', 'yellow');

    store.getState().dismissFinishedAgent('done');

    expect(store.getState().agentColors).toEqual({});
  });

  it('forgets markers for agents evicted by the retention cap', () => {
    const finished = Array.from({ length: MAX_FINISHED_AGENTS + 1 }, (_, i) => ({
      ...withStatus(`agent-${i}`, 'idle'),
      startedAt: i,
    }));
    store.setState({ agents: finished });
    store.getState().setAgentColor('agent-0', 'purple');

    store.getState().updateAgentStatus('agent-1', 'idle');

    expect(store.getState().agentColors['agent-0']).toBeUndefined();
  });
});

describe('agentSlice – collapsed repo groups', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('starts with every group open', () => {
    expect(store.getState().collapsedAgentRepos).toEqual([]);
  });

  it('collapses and reopens a group', () => {
    store.getState().toggleAgentRepoCollapsed('/work/api');
    expect(store.getState().collapsedAgentRepos).toEqual(['/work/api']);

    store.getState().toggleAgentRepoCollapsed('/work/api');
    expect(store.getState().collapsedAgentRepos).toEqual([]);
  });

  it('keeps groups independent of each other', () => {
    store.getState().toggleAgentRepoCollapsed('/work/api');
    store.getState().toggleAgentRepoCollapsed('/work/web');
    expect(store.getState().collapsedAgentRepos).toEqual(['/work/api', '/work/web']);
  });
});

describe('agentSlice – dismissing finished agents', () => {
  let store: StoreApi<AgentSlice>;

  const withStatus = (id: string, status: 'running' | 'idle' | 'error') => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status,
    startedAt: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
  });

  it('clears a finished agent out of the fleet', () => {
    store.setState({
      agents: [withStatus('done', 'idle'), withStatus('busy', 'running')],
      agentLogs: { done: ['output'], busy: ['output'] },
      agentLogMeta: { done: { seq: 1, bytes: 6 }, busy: { seq: 1, bytes: 6 } },
    });

    store.getState().dismissFinishedAgent('done');

    expect(store.getState().agents.map((a) => a.id)).toEqual(['busy']);
    expect(store.getState().agentLogs).toEqual({ busy: ['output'] });
    expect(store.getState().agentLogMeta.done).toBeUndefined();
  });

  it('clears a failed agent too', () => {
    store.setState({ agents: [withStatus('broken', 'error')] });
    store.getState().dismissFinishedAgent('broken');
    expect(store.getState().agents).toEqual([]);
  });

  it('refuses to dismiss an agent that is still working', async () => {
    const agents = await import('../tauri/agents');
    store.setState({ agents: [withStatus('busy', 'running')] });

    // Dismissing is tidying up, not stopping — it must never silently
    // discard an agent that is still doing something.
    store.getState().dismissFinishedAgent('busy');

    expect(store.getState().agents.map((a) => a.id)).toEqual(['busy']);
    expect(agents.killAgent).not.toHaveBeenCalled();
  });

  it('forgets a parked flag along with the agent', () => {
    store.setState({ agents: [withStatus('done', 'idle')] });
    store.getState().setAgentMinimized('done', true);

    store.getState().dismissFinishedAgent('done');

    expect(store.getState().minimizedAgentIds).toEqual([]);
  });

  it('shrugs off an unknown id', () => {
    store.setState({ agents: [withStatus('done', 'idle')] });
    store.getState().dismissFinishedAgent('nope');
    expect(store.getState().agents).toHaveLength(1);
  });
});

describe('agentSlice – derived current activity', () => {
  let store: StoreApi<AgentSlice>;

  const runningAgent = {
    id: 'a1',
    name: 'A',
    model: 'm',
    provider: 'claude',
    status: 'running' as const,
    startedAt: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
    store.setState({ agents: [runningAgent] });
  });

  it('reports what the agent is doing from its newest output', () => {
    store.getState().appendAgentLog('a1', 'Editing setup.ts\n');
    expect(store.getState().agents[0].currentActivity).toBe('Editing setup.ts');
  });

  it('leaves the start instruction alone — the two say different things', () => {
    store.setState({ agents: [{ ...runningAgent, currentTask: 'Refactor the parser' }] });
    store.getState().appendAgentLog('a1', 'Editing setup.ts\n');

    const agent = store.getState().agents[0];
    expect(agent.currentTask).toBe('Refactor the parser');
    expect(agent.currentActivity).toBe('Editing setup.ts');
  });

  it('keeps the last known activity while the output is only redraw noise', () => {
    store.getState().appendAgentLog('a1', 'Editing setup.ts\n');
    // Force the next append past the throttle window so it would update.
    store.setState({ agents: store.getState().agents.map((a) => ({ ...a, lastActivityAt: 0 })) });
    store.getState().appendAgentLog('a1', '╭───╮\n');

    expect(store.getState().agents[0].currentActivity).toBe('Editing setup.ts');
  });

  it('costs no extra renders — it rides the throttled activity bump', () => {
    store.getState().appendAgentLog('a1', 'first line\n');
    const afterFirst = store.getState().agents;

    // Within the throttle window the agents array must stay identical.
    store.getState().appendAgentLog('a1', 'second line\n');
    expect(store.getState().agents).toBe(afterFirst);
  });
});

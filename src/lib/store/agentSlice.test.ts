import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AgentSlice } from './agentSlice';
import { agentLogAppend, agentLogLoad, agentLogPrune } from '../tauri/agentLog';
import { APP_CONFIG_KEYS } from '../config/appConfig';
import { flushAgentLog, resetAgentLogWriter } from '../agents/events/persistence';
import { HEARTBEAT_BANDS, type HeartbeatBucket } from '../agents/events/heartbeat';

/** Every event counted into an agent's heartbeat window, across all bands. */
function totalHeartbeat(buckets: HeartbeatBucket[]): number {
  return buckets.reduce(
    (sum, bucket) => sum + HEARTBEAT_BANDS.reduce((n, band) => n + (bucket.counts[band] ?? 0), 0),
    0
  );
}
import {
  createAgentSlice,
  groupAgentsByRepo,
  MAX_AGENT_EVENTS,
  MAX_AGENT_LOGS,
  MAX_AGENT_LOG_BYTES,
  MAX_FINISHED_AGENTS,
  UNGROUPED_REPO_KEY,
} from './agentSlice';

vi.mock('../tauri/agentLog', () => ({
  agentLogAppend: vi.fn(async () => undefined),
  agentLogLoad: vi.fn(async () => []),
  agentLogPrune: vi.fn(async () => 0),
  agentLogPurge: vi.fn(async () => undefined),
}));

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
  sendToAgent: vi.fn(async () => undefined),
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

  it('announces a failure as a toast, once', async () => {
    const { createToastSlice } = await import('./toastSlice');
    const combined = createStore<AgentSlice & import('./toastSlice').ToastSlice>()((...a) => ({
      ...createAgentSlice(...a),
      ...createToastSlice(...a),
    }));
    await combined.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    combined.getState().updateAgentStatus('mock-agent-1', 'error');
    expect(combined.getState().toasts).toHaveLength(1);
    expect(combined.getState().toasts[0].message).toContain('Writer');
    expect(combined.getState().toasts[0].variant).toBe('error');

    // A duplicate stop signal must not stack a second toast.
    combined.getState().updateAgentStatus('mock-agent-1', 'error');
    expect(combined.getState().toasts).toHaveLength(1);
  });

  describe('the inbox record of a failure', () => {
    async function withInbox() {
      const { createNotificationsSlice } = await import('./notificationsSlice');
      type Combined = AgentSlice & import('./notificationsSlice').NotificationsSlice;
      const combined = createStore<Combined>()((...a) => ({
        ...createAgentSlice(...a),
        ...createNotificationsSlice(...a),
      }));
      await combined.getState().spawnNewAgent({
        name: 'Writer',
        model: 'claude-opus-4-6',
        task: 'Write docs',
      });
      return combined;
    }

    // The toast interrupts; this is what is still there tomorrow. The record
    // is the reason a failure in a repo you are not looking at is findable.
    it('writes one entry naming the agent', async () => {
      const combined = await withInbox();
      combined.getState().updateAgentStatus('mock-agent-1', 'error');

      await vi.waitFor(() => {
        expect(combined.getState().notifications).toHaveLength(1);
      });
      const entry = combined.getState().notifications[0];
      expect(entry.title).toContain('Writer');
      expect(entry.severity).toBe('error');
      expect(entry.refKind).toBe('agent');
      expect(entry.refId).toBe('mock-agent-1');
    });

    it('offers a way back to the agent output', async () => {
      const combined = await withInbox();
      combined.getState().updateAgentStatus('mock-agent-1', 'error');

      await vi.waitFor(() => {
        expect(combined.getState().notifications).toHaveLength(1);
      });
      expect(combined.getState().notifications[0].actions).toEqual([
        {
          id: 'logs',
          label: 'Open logs',
          kind: 'open',
          target: { type: 'agent', agentId: 'mock-agent-1' },
        },
      ]);
    });

    it('does not stack on a duplicate stop signal', async () => {
      const combined = await withInbox();
      combined.getState().updateAgentStatus('mock-agent-1', 'error');
      await vi.waitFor(() => expect(combined.getState().notifications).toHaveLength(1));

      combined.getState().updateAgentStatus('mock-agent-1', 'error');
      // Long enough for a second dispatch to have landed if one were made.
      await new Promise((r) => setTimeout(r, 20));

      expect(combined.getState().notifications).toHaveLength(1);
    });

    it('writes nothing while the conductor will retry the ticket itself', async () => {
      const combined = await withInbox();
      combined.setState({
        conductorAssignments: { 'ticket-1': 'mock-agent-1' },
        conductorFailedTickets: {},
      } as never);

      combined.getState().updateAgentStatus('mock-agent-1', 'error');
      await new Promise((r) => setTimeout(r, 20));

      expect(combined.getState().notifications).toHaveLength(0);
    });

    it('writes nothing for a clean finish', async () => {
      const combined = await withInbox();
      combined.getState().updateAgentStatus('mock-agent-1', 'idle');
      await new Promise((r) => setTimeout(r, 20));

      expect(combined.getState().notifications).toHaveLength(0);
    });
  });

  it('stays silent while the conductor will retry the ticket itself', async () => {
    // Interrupting the user for a failure the system is about to handle
    // would be a false alarm — only the final, given-up failure toasts.
    const { createToastSlice } = await import('./toastSlice');
    const combined = createStore<AgentSlice & import('./toastSlice').ToastSlice>()((...a) => ({
      ...createAgentSlice(...a),
      ...createToastSlice(...a),
    }));
    await combined.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    combined.setState({
      conductorAssignments: { 'ticket-1': 'mock-agent-1' },
      conductorFailedTickets: {},
    } as never);

    combined.getState().updateAgentStatus('mock-agent-1', 'error');
    expect(combined.getState().toasts).toHaveLength(0);
  });

  it('toasts the conductor ticket that has used up its attempts', async () => {
    const { createToastSlice } = await import('./toastSlice');
    const combined = createStore<AgentSlice & import('./toastSlice').ToastSlice>()((...a) => ({
      ...createAgentSlice(...a),
      ...createToastSlice(...a),
    }));
    await combined.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    combined.setState({
      conductorAssignments: { 'ticket-1': 'mock-agent-1' },
      conductorFailedTickets: { 'ticket-1': 1 },
    } as never);

    combined.getState().updateAgentStatus('mock-agent-1', 'error');
    expect(combined.getState().toasts).toHaveLength(1);
  });

  it('keeps a resumed agent retryable with its persisted config', async () => {
    // The interrupted record carries permission mode and headless — a later
    // retry must not silently downgrade them to defaults.
    await store.getState().loadInterruptedAgents();
    const resumed = await store.getState().resumeInterruptedAgent('agent-9');

    const config = store.getState().agentSpawnConfigs[resumed.id];
    expect(config).toBeDefined();
    expect(config.permissionMode).toBe('auto');
    expect(config.task).toBe('refactor the parser');
    expect(config.cwd).toBe('/repo');
  });

  it('does not toast a clean finish — only failures make noise', async () => {
    const { createToastSlice } = await import('./toastSlice');
    const combined = createStore<AgentSlice & import('./toastSlice').ToastSlice>()((...a) => ({
      ...createAgentSlice(...a),
      ...createToastSlice(...a),
    }));
    await combined.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    combined.getState().updateAgentStatus('mock-agent-1', 'idle');
    expect(combined.getState().toasts).toHaveLength(0);
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

  it('marks a finished agent reviewed without touching selectedAgentId', async () => {
    // The Agent Console needs "mark reviewed" without also stealing the
    // bottom terminal panel's active tab the way selectAgent's side effect
    // would — reviewing from the console must not relocate the user's focus.
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });
    store.getState().updateAgentStatus('mock-agent-1', 'idle');
    store.getState().selectAgent('other-agent');

    store.getState().markAgentReviewed('mock-agent-1');

    expect(store.getState().reviewedAgentIds).toContain('mock-agent-1');
    expect(store.getState().selectedAgentId).toBe('other-agent');
  });

  it('does not mark a still-running agent reviewed via markAgentReviewed', async () => {
    await store.getState().spawnNewAgent({
      name: 'Writer',
      model: 'claude-opus-4-6',
      task: 'Write docs',
    });

    store.getState().markAgentReviewed('mock-agent-1');

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

  it('killAgentsForRepoPath ends agents that carry no repo path', async () => {
    const { killAgent, killAgentsForRepo } = await import('../tauri/agents');
    vi.mocked(killAgent).mockClear();
    vi.mocked(killAgentsForRepo).mockClear();
    store.setState({
      agents: [
        {
          id: '1',
          name: 'A',
          model: 'm',
          provider: 'claude',
          status: 'running' as const,
          startedAt: 0,
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

    // 'Unknown' is the bucket groupAgentsByRepo shows these under — a display
    // key, never a path. Stop all on that group has to actually end them
    // instead of matching a repo path nobody has.
    await store.getState().killAgentsForRepoPath(UNGROUPED_REPO_KEY);

    expect(store.getState().agents.map((a) => a.id)).toEqual(['2']);
    expect(killAgent).toHaveBeenCalledWith('1');
    expect(killAgentsForRepo).not.toHaveBeenCalled();
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

describe('agentSlice – event extraction', () => {
  let store: StoreApi<AgentSlice>;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = createStore<AgentSlice>()(createAgentSlice);
    // Extractors live in a module-level registry outside the store, keyed by
    // agent id — reset it so no test here inherits another test's buffer.
    const { resetAgentExtractors } = await import('../agents/events/registry');
    resetAgentExtractors();
  });

  const claudeAgent = (id: string) => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status: 'running' as const,
    startedAt: 0,
  });

  it('turns a recognizable log chunk into a structured event', () => {
    store.setState({ agents: [claudeAgent('events-a')] });
    store.getState().appendAgentLog('events-a', '⏺ Read(src/lib/example.ts)\n');

    expect(store.getState().agentEvents['events-a']).toEqual([
      expect.objectContaining({
        kind: 'read',
        label: 'Read src/lib/example.ts',
        path: 'src/lib/example.ts',
      }),
    ]);
  });

  it('completes a line split across two log chunks', () => {
    store.setState({ agents: [claudeAgent('events-b')] });
    store.getState().appendAgentLog('events-b', '⏺ Bash(pnpm te');
    expect(store.getState().agentEvents['events-b']).toBeUndefined();

    store.getState().appendAgentLog('events-b', 'st:run)\n');
    expect(store.getState().agentEvents['events-b']).toEqual([
      expect.objectContaining({ kind: 'run', label: 'Ran pnpm test:run' }),
    ]);
  });

  it('uses the agent’s own provider to pick the matcher, not a default', () => {
    // A bare "$ cmd" line is a run event to the generic matcher but not to
    // Claude's — proves the agent's `provider` field actually drives this.
    store.setState({ agents: [claudeAgent('events-c')] });
    store.getState().appendAgentLog('events-c', '$ pnpm build\n');
    expect(store.getState().agentEvents['events-c']).toBeUndefined();
  });

  it('falls back to the generic matcher when the agent is not in the fleet', () => {
    // appendAgentLog can be called for an id with no matching AgentInfo yet.
    store.getState().appendAgentLog('events-unknown', '$ pnpm build\n');
    expect(store.getState().agentEvents['events-unknown']).toEqual([
      expect.objectContaining({ kind: 'run', label: 'Ran pnpm build' }),
    ]);
  });

  it('switches to the real matcher once the agent lands in the fleet, even if output arrived first', () => {
    // Tauri does not order PTY output events against the spawn-result await —
    // a chunk can and does arrive before spawnNewAgent has added the agent.
    store.getState().appendAgentLog('a', 'banner\n');
    expect(store.getState().agentEvents['a']).toBeUndefined();

    store.setState({ agents: [claudeAgent('a')] });
    // A bare "$ cmd" line would match the generic fallback but not Claude's —
    // this only produces an event if the extractor actually rebuilt with the
    // now-known real provider instead of staying stuck on the guess.
    store.getState().appendAgentLog('a', '⏺ Read(src/x.ts)\n');

    expect(store.getState().agentEvents['a']).toEqual([
      expect.objectContaining({ kind: 'read', label: 'Read src/x.ts', path: 'src/x.ts' }),
    ]);
  });

  it('caps retained events per agent at MAX_AGENT_EVENTS, dropping the oldest', () => {
    store.setState({ agents: [claudeAgent('events-cap')] });
    for (let i = 0; i < MAX_AGENT_EVENTS + 20; i++) {
      store.getState().appendAgentLog('events-cap', `⏺ Bash(step ${i})\n`);
    }
    const events = store.getState().agentEvents['events-cap'];
    expect(events).toHaveLength(MAX_AGENT_EVENTS);
    expect(events[0].label).toBe('Ran step 20');
    expect(events[events.length - 1].label).toBe(`Ran step ${MAX_AGENT_EVENTS + 19}`);
  });

  it('does not replace the agentEvents record when a chunk produces no event', () => {
    store.setState({ agents: [claudeAgent('events-quiet')] });
    store.getState().appendAgentLog('events-quiet', '⏺ Bash(pnpm lint)\n');
    const afterFirst = store.getState().agentEvents;

    // A redraw-only chunk with no new event must not touch the record at all.
    store.getState().appendAgentLog('events-quiet', '╭───╮\n');
    expect(store.getState().agentEvents).toBe(afterFirst);
  });

  it('drops the accumulated events when a finished agent is dismissed', () => {
    store.setState({ agents: [{ ...claudeAgent('events-dismiss'), status: 'idle' as const }] });
    store.getState().appendAgentLog('events-dismiss', '⏺ Bash(pnpm lint)\n');
    expect(store.getState().agentEvents['events-dismiss']).toBeDefined();

    store.getState().dismissFinishedAgent('events-dismiss');
    expect(store.getState().agentEvents['events-dismiss']).toBeUndefined();
    expect(store.getState().agentHeartbeat['events-dismiss']).toBeUndefined();
  });

  it('drops the accumulated events when a running agent is killed', async () => {
    store.setState({ agents: [claudeAgent('events-kill')] });
    store.getState().appendAgentLog('events-kill', '⏺ Bash(pnpm lint)\n');
    expect(store.getState().agentEvents['events-kill']).toBeDefined();

    await store.getState().killRunningAgent('events-kill');
    expect(store.getState().agentEvents['events-kill']).toBeUndefined();
    expect(store.getState().agentHeartbeat['events-kill']).toBeUndefined();
  });

  it('drops accumulated events for agents evicted past the finished-agent cap', () => {
    const finished = Array.from({ length: MAX_FINISHED_AGENTS }, (_, i) => ({
      ...claudeAgent(`events-evict-${i}`),
      status: 'idle' as const,
      startedAt: i,
    }));
    store.setState({
      agents: [...finished, { ...claudeAgent('events-evict-new'), startedAt: 1000 }],
    });
    for (const a of finished) {
      store.getState().appendAgentLog(a.id, '⏺ Bash(pnpm lint)\n');
    }

    // Pushes the finished count past MAX_FINISHED_AGENTS, evicting the oldest.
    store.getState().updateAgentStatus('events-evict-new', 'idle');

    expect(store.getState().agentEvents['events-evict-0']).toBeUndefined();
    expect(store.getState().agentEvents[`events-evict-${MAX_FINISHED_AGENTS - 1}`]).toBeDefined();
  });

  it('drops accumulated events for every agent killed in a repo', async () => {
    store.setState({
      agents: [
        { ...claudeAgent('events-repo-1'), repoPath: '/repo-a' },
        { ...claudeAgent('events-repo-2'), repoPath: '/repo-a' },
      ],
    });
    store.getState().appendAgentLog('events-repo-1', '⏺ Bash(pnpm lint)\n');
    store.getState().appendAgentLog('events-repo-2', '⏺ Bash(pnpm lint)\n');

    await store.getState().killAgentsForRepoPath('/repo-a');

    expect(store.getState().agentEvents['events-repo-1']).toBeUndefined();
    expect(store.getState().agentEvents['events-repo-2']).toBeUndefined();
  });

  it('counts one heartbeat entry per recognised event, flushed at the throttle', () => {
    store.setState({ agents: [claudeAgent('events-heartbeat')] });
    store.getState().appendAgentLog('events-heartbeat', '⏺ Bash(pnpm lint)\n'); // fresh agent: bumps
    // Force the next append past the throttle too, so its accumulated counts
    // flush rather than merely sitting in the pending accumulator.
    store.setState({ agents: store.getState().agents.map((a) => ({ ...a, lastActivityAt: 0 })) });
    store.getState().appendAgentLog('events-heartbeat', '⏺ Edit(src/a.ts)\n');

    const buckets = store.getState().agentHeartbeat['events-heartbeat'];
    expect(totalHeartbeat(buckets)).toBe(2);
  });

  it('leaves the heartbeat alone for output that produced no event at all', () => {
    // Bytes used to drive this, which made an agent printing a long file look
    // busier than one making a careful edit.
    store.setState({ agents: [claudeAgent('events-hb-prose')] });
    store.getState().appendAgentLog('events-hb-prose', 'just some prose, no tool call\n');
    store.setState({ agents: store.getState().agents.map((a) => ({ ...a, lastActivityAt: 0 })) });
    store.getState().appendAgentLog('events-hb-prose', 'more prose\n');

    expect(store.getState().agentHeartbeat['events-hb-prose']).toBeUndefined();
  });

  it('does not replace the agentHeartbeat record for a chunk inside the throttle window', () => {
    store.setState({ agents: [claudeAgent('events-hb-throttle')] });
    store.getState().appendAgentLog('events-hb-throttle', '⏺ Bash(pnpm lint)\n'); // fresh agent: bumps
    const afterFirst = store.getState().agentHeartbeat;

    // Still inside the throttle window — no lastActivityAt reset here, so
    // this chunk's counts must accumulate in the registry, not the store.
    store.getState().appendAgentLog('events-hb-throttle', '⏺ Bash(pnpm test)\n');
    expect(store.getState().agentHeartbeat).toBe(afterFirst);
  });

  it('does not lose pending heartbeat counts accumulated while inside the throttle window', () => {
    store.setState({ agents: [claudeAgent('events-hb-pending')] });
    store.getState().appendAgentLog('events-hb-pending', '⏺ Bash(one)\n'); // fresh agent: bumps
    store.getState().appendAgentLog('events-hb-pending', '⏺ Bash(two)\n'); // inside the window: pending only

    // Cross the throttle now — the pending counts from the second chunk must
    // still be reflected, not dropped because they never flushed.
    store.setState({ agents: store.getState().agents.map((a) => ({ ...a, lastActivityAt: 0 })) });
    store.getState().appendAgentLog('events-hb-pending', '⏺ Bash(three)\n');

    const buckets = store.getState().agentHeartbeat['events-hb-pending'];
    expect(totalHeartbeat(buckets)).toBe(3);
  });

  it('charts the last of a finished agent’s work, which no further chunk would carry', () => {
    store.setState({ agents: [claudeAgent('events-hb-finish')] });
    store.getState().appendAgentLog('events-hb-finish', '⏺ Bash(one)\n'); // fresh agent: bumps
    store.getState().appendAgentLog('events-hb-finish', '⏺ Bash(two)\n'); // inside the window: pending only

    // No chunk is coming after this one — the agent is done.
    store.getState().updateAgentStatus('events-hb-finish', 'idle');

    const buckets = store.getState().agentHeartbeat['events-hb-finish'];
    expect(totalHeartbeat(buckets)).toBe(2);
  });

  it('sweeps orphaned records for an id that appended logs but never landed in agents, on refresh', async () => {
    const { listAgents } = await import('../tauri/agents');
    store.getState().appendAgentLog('orphan', '$ pnpm build\n');
    expect(store.getState().agentEvents['orphan']).toBeDefined();

    vi.mocked(listAgents).mockResolvedValueOnce([]);
    await store.getState().refreshAgents();

    expect(store.getState().agentEvents['orphan']).toBeUndefined();
  });

  it('sweeps an orphaned id as a side effect of an unrelated agent being cleaned up', async () => {
    store.setState({ agents: [claudeAgent('events-real')] });
    store.getState().appendAgentLog('orphan-2', '$ pnpm build\n');
    store.getState().appendAgentLog('events-real', '⏺ Bash(pnpm lint)\n');
    expect(store.getState().agentEvents['orphan-2']).toBeDefined();

    await store.getState().killRunningAgent('events-real');

    expect(store.getState().agentEvents['orphan-2']).toBeUndefined();
  });
});

describe('sendAgentInput', () => {
  it('writes the exact bytes given to the agent PTY', async () => {
    const store = createStore<AgentSlice>()(createAgentSlice);
    const agents = await import('../tauri/agents');

    await store.getState().sendAgentInput('agent-1', '1\n');

    expect(agents.sendToAgent).toHaveBeenCalledWith('agent-1', '1\n');
  });

  it('does not decide the bytes itself — a free-text send goes through verbatim', async () => {
    const store = createStore<AgentSlice>()(createAgentSlice);
    const agents = await import('../tauri/agents');

    await store.getState().sendAgentInput('agent-1', 'run the tests\n');

    expect(agents.sendToAgent).toHaveBeenCalledWith('agent-1', 'run the tests\n');
  });
});

describe('agentSlice – on-disk history', () => {
  let store: StoreApi<AgentSlice>;

  const claudeAgent = (id: string) => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status: 'running' as const,
    startedAt: 0,
  });

  beforeEach(() => {
    localStorage.clear();
    resetAgentLogWriter();
    vi.mocked(agentLogAppend).mockClear();
    vi.mocked(agentLogLoad).mockClear();
    vi.mocked(agentLogPrune).mockClear();
    store = createStore<AgentSlice>()((...a) => createAgentSlice(...a));
  });

  const enable = () => localStorage.setItem(APP_CONFIG_KEYS.agentLogPersist, 'true');

  it('writes nothing while the setting is off, however much an agent produces', async () => {
    store.setState({ agents: [claudeAgent('hist-off')] });
    store.getState().appendAgentLog('hist-off', '⏺ Edit(src/a.ts)\n');
    await flushAgentLog();

    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('writes the extracted events once the setting is on', async () => {
    enable();
    store.setState({ agents: [claudeAgent('hist-on')] });
    store.getState().appendAgentLog('hist-on', '⏺ Edit(src/a.ts)\n');
    await flushAgentLog();

    expect(agentLogAppend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(agentLogAppend).mock.calls[0][0][0]).toMatchObject({
      agentId: 'hist-on',
      kind: 'edit',
      label: 'Edited src/a.ts',
    });
  });

  it('records the agent name and repo, so a row outlives the agent', async () => {
    enable();
    store.setState({
      agents: [{ ...claudeAgent('hist-named'), name: 'Waitlist', repoPath: '/repos/acme-app' }],
    });
    store.getState().appendAgentLog('hist-named', '⏺ Edit(src/a.ts)\n');
    await flushAgentLog();

    expect(vi.mocked(agentLogAppend).mock.calls[0][0][0]).toMatchObject({
      agentName: 'Waitlist',
      repoPath: '/repos/acme-app',
    });
  });

  it('writes nothing for output that produced no event', async () => {
    enable();
    store.setState({ agents: [claudeAgent('hist-prose')] });
    store.getState().appendAgentLog('hist-prose', 'just prose, no tool call\n');
    await flushAgentLog();

    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('loads the stored history, newest first, and keeps it apart from live events', async () => {
    enable();
    vi.mocked(agentLogLoad).mockResolvedValueOnce([
      { agentId: 'gone', agentName: 'Old', kind: 'edit', label: 'Edited x.ts', at: 5, seq: 0 },
    ]);

    await store.getState().loadAgentLogHistory();

    expect(store.getState().agentLogHistory).toHaveLength(1);
    expect(store.getState().agentEvents).toEqual({});
  });

  it('trims the history before reading it back', async () => {
    enable();
    await store.getState().loadAgentLogHistory();
    expect(agentLogPrune).toHaveBeenCalled();
  });

  it('loads nothing and prunes nothing while the setting is off', async () => {
    await store.getState().loadAgentLogHistory();

    expect(agentLogLoad).not.toHaveBeenCalled();
    expect(agentLogPrune).not.toHaveBeenCalled();
    expect(store.getState().agentLogHistory).toEqual([]);
  });

  it('leaves the history empty rather than failing when the store is unreachable', async () => {
    enable();
    vi.mocked(agentLogLoad).mockRejectedValueOnce(new Error('no db'));

    await expect(store.getState().loadAgentLogHistory()).resolves.toBeUndefined();
    expect(store.getState().agentLogHistory).toEqual([]);
  });

  /** An agent that just bumped its activity, so nothing it prints flushes. */
  const busyAgent = (id: string) => ({ ...claudeAgent(id), lastActivityAt: Date.now() });

  it('writes the run of an agent that started and finished inside one throttle window', () => {
    enable();
    store.setState({ agents: [busyAgent('hist-short')] });
    store.getState().appendAgentLog('hist-short', '⏺ Edit(src/a.ts)\n');
    expect(agentLogAppend).not.toHaveBeenCalled();

    store.getState().updateAgentStatus('hist-short', 'idle');

    expect(vi.mocked(agentLogAppend).mock.calls[0][0]).toEqual([
      expect.objectContaining({ agentId: 'hist-short', label: 'Edited src/a.ts' }),
    ]);
  });

  it('writes the run of an agent that failed, not only one that finished cleanly', () => {
    enable();
    store.setState({ agents: [busyAgent('hist-failed')] });
    store.getState().appendAgentLog('hist-failed', '⏺ Bash(pnpm test:run)\n');

    store.getState().updateAgentStatus('hist-failed', 'error');

    expect(vi.mocked(agentLogAppend).mock.calls[0][0]).toEqual([
      expect.objectContaining({ agentId: 'hist-failed', label: 'Ran pnpm test:run' }),
    ]);
  });

  it('writes what arrived after the last throttled flush, not only up to it', () => {
    enable();
    store.setState({ agents: [claudeAgent('hist-tail')] }); // no lastActivityAt: the first chunk bumps
    store.getState().appendAgentLog('hist-tail', '⏺ Read(src/a.ts)\n');
    expect(agentLogAppend).toHaveBeenCalledTimes(1);

    // Inside the throttle window now — nothing else would ever carry this one.
    store.getState().appendAgentLog('hist-tail', '⏺ Edit(src/b.ts)\n');
    store.getState().updateAgentStatus('hist-tail', 'idle');

    expect(vi.mocked(agentLogAppend).mock.calls[1][0]).toEqual([
      expect.objectContaining({ label: 'Edited src/b.ts' }),
    ]);
  });

  it('does not write the same run twice when a stop event arrives twice', () => {
    enable();
    store.setState({ agents: [busyAgent('hist-twice')] });
    store.getState().appendAgentLog('hist-twice', '⏺ Edit(src/a.ts)\n');

    store.getState().updateAgentStatus('hist-twice', 'idle');
    store.getState().updateAgentStatus('hist-twice', 'idle');

    expect(agentLogAppend).toHaveBeenCalledTimes(1);
  });

  it('writes what a killed agent produced — no stop event is ever coming for it', async () => {
    enable();
    store.setState({ agents: [busyAgent('hist-killed')] });
    store.getState().appendAgentLog('hist-killed', '⏺ Edit(src/a.ts)\n');

    await store.getState().killRunningAgent('hist-killed');

    expect(vi.mocked(agentLogAppend).mock.calls[0][0]).toEqual([
      expect.objectContaining({ agentId: 'hist-killed', label: 'Edited src/a.ts' }),
    ]);
  });

  it('writes what every agent killed with its repo group produced', async () => {
    enable();
    store.setState({
      agents: [
        { ...busyAgent('hist-repo-1'), repoPath: '/repo-a' },
        { ...busyAgent('hist-repo-2'), repoPath: '/repo-a' },
      ],
    });
    store.getState().appendAgentLog('hist-repo-1', '⏺ Edit(src/a.ts)\n');
    store.getState().appendAgentLog('hist-repo-2', '⏺ Edit(src/b.ts)\n');

    await store.getState().killAgentsForRepoPath('/repo-a');

    expect(vi.mocked(agentLogAppend).mock.calls[0][0]).toEqual([
      expect.objectContaining({ agentId: 'hist-repo-1' }),
      expect.objectContaining({ agentId: 'hist-repo-2' }),
    ]);
  });

  it('still writes nothing when an agent finishes while the setting is off', () => {
    store.setState({ agents: [busyAgent('hist-off-finish')] });
    store.getState().appendAgentLog('hist-off-finish', '⏺ Edit(src/a.ts)\n');

    store.getState().updateAgentStatus('hist-off-finish', 'idle');

    expect(agentLogAppend).not.toHaveBeenCalled();
  });
});

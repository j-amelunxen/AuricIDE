import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import type { StoreState } from './index';
import { forgetSupervisorRunResults, spawnAgent, type AgentInfo } from '../tauri/agents';
import { supervisorPolicyGet } from '../tauri/supervisorPolicy';
import { emptySupervisorPolicy, defaultSupervisorProjectPolicy } from '../config/supervisorPolicy';
import type { ProviderInfo } from '../tauri/providers';

vi.mock('../tauri/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spawnAgent: vi.fn(async (config: any) => ({
    id: 'sup-1',
    name: config.name,
    model: config.model,
    provider: config.provider,
    status: 'running' as const,
    currentTask: config.task,
    startedAt: 1000,
    role: config.role,
  })),
  killAgent: vi.fn(async () => undefined),
  forgetSupervisorRunResults: vi.fn(async () => 0),
  listAgents: vi.fn(async () => []),
  recordAgentPromptHistory: vi.fn(async () => undefined),
}));

const { CLAUDE_FROM_REGISTRY, CODEX_FROM_REGISTRY } = vi.hoisted(() => ({
  CLAUDE_FROM_REGISTRY: {
    id: 'claude',
    name: 'Claude Code',
    models: [{ value: 'fable', label: 'Fable', rank: 4 }],
    permissionModes: [],
    defaultModel: 'fable',
    defaultPermissionMode: 'default',
  },
  CODEX_FROM_REGISTRY: {
    id: 'codex',
    name: 'Codex',
    models: [{ value: 'luna', label: 'Luna', rank: 1 }],
    permissionModes: [],
    defaultModel: 'luna',
    defaultPermissionMode: 'default',
  },
}));

vi.mock('../tauri/providers', () => ({
  listProviders: vi.fn(async () => [CLAUDE_FROM_REGISTRY, CODEX_FROM_REGISTRY]),
}));
vi.mock('../tauri/supervisorPolicy', () => ({ supervisorPolicyGet: vi.fn() }));
vi.mock('../tauri/providerPolicy', () => ({
  projectProviderPolicyGet: vi.fn(async () => ({ allow: null, deny: [] })),
}));

const CLAUDE: ProviderInfo = {
  id: 'claude',
  name: 'Claude Code',
  models: [{ value: 'sonnet', label: 'Sonnet', rank: 2 }],
  permissionModes: [],
  defaultModel: 'sonnet',
  defaultPermissionMode: 'default',
};

describe('spawnSupervisor', () => {
  let store: StoreApi<StoreState>;

  beforeEach(() => {
    vi.mocked(spawnAgent).mockClear();
    store = createStore<StoreState>()(
      (...args) =>
        ({
          ...createAgentSlice(...(args as Parameters<typeof createAgentSlice>)),
          providers: [CLAUDE],
          starredProjects: [
            { path: '/work/project-a', name: 'project-a', starredAt: 0, description: 'Sample' },
          ],
          rootPath: null,
        }) as unknown as StoreState
    );
  });

  it('spawns a supervisor when the policy shows a project', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });

    const launch = await store.getState().spawnSupervisor();

    expect(launch.kind).toBe('spawned');
    const config = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(config).toMatchObject({ role: 'supervisor', provider: 'claude', headless: false });
    expect(config.task).toContain('Sample');
    // The registry's list, not the store's one narrowed to the open project.
    expect(config.model).toBe('fable');
    expect(store.getState().agents.map((a) => a.id)).toEqual(['sup-1']);
  });

  it('spawns nothing when no project is allowed', async () => {
    vi.mocked(supervisorPolicyGet).mockResolvedValue({
      policy: emptySupervisorPolicy(),
      rejected: [],
    });
    expect(await store.getState().spawnSupervisor()).toEqual({ kind: 'nothing-visible' });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('hands back the running supervisor instead of starting a second', async () => {
    const running: AgentInfo = {
      id: 'sup-0',
      name: 'Supervisor',
      model: 'sonnet',
      provider: 'claude',
      status: 'running',
      startedAt: 1,
      role: 'supervisor',
    };
    store.setState({ agents: [running] });
    expect(await store.getState().spawnSupervisor()).toEqual({ kind: 'running', agent: running });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('starts a supervisor on a skill: its prompt is the first task, its model wins', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });

    await store.getState().spawnSupervisor({ task: 'Ask for the build status', model: 'haiku' });

    const config = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(config.task).toMatch(/## Your first task\n\nAsk for the build status$/);
    expect(config.model).toBe('haiku');
  });

  it('sends a skill to the running supervisor instead of starting a second', async () => {
    const running: AgentInfo = {
      id: 'sup-0',
      name: 'Supervisor',
      model: 'sonnet',
      provider: 'claude',
      status: 'running',
      startedAt: 1,
      role: 'supervisor',
    };
    const sendAgentInput = vi.fn(async () => undefined);
    store.setState({ agents: [running], sendAgentInput });

    expect(await store.getState().spawnSupervisor({ task: 'Ask for the build status' })).toEqual({
      kind: 'sent',
      agent: running,
    });
    // Enter is \r: \n only adds a line in Claude Code's input box.
    expect(sendAgentInput).toHaveBeenCalledWith('sup-0', 'Ask for the build status\r');
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('prompts user for provider when multiple supervisor providers are candidate', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    policy.supervisor = {
      provider: 'claude',
      providers: ['claude', 'codex'],
      model: null,
      chrome: false,
    };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });

    const openSupervisorProviderChoice = vi.fn(async () => 'codex');
    store.setState({ openSupervisorProviderChoice } as never);

    const launch = await store.getState().spawnSupervisor();
    expect(openSupervisorProviderChoice).toHaveBeenCalledWith([
      { id: 'claude', name: 'Claude Code' },
      { id: 'codex', name: 'Codex' },
    ]);
    expect(launch.kind).toBe('spawned');
    const config = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(config.provider).toBe('codex');
  });

  it('cancels spawn when user cancels provider choice modal', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    policy.supervisor = {
      provider: 'claude',
      providers: ['claude', 'codex'],
      model: null,
      chrome: false,
    };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });

    const openSupervisorProviderChoice = vi.fn(async () => null);
    store.setState({ openSupervisorProviderChoice } as never);

    const launch = await store.getState().spawnSupervisor();
    expect(openSupervisorProviderChoice).toHaveBeenCalled();
    expect(launch).toEqual({ kind: 'cancelled' });
    expect(spawnAgent).not.toHaveBeenCalled();
  });
});

describe("clearing a supervisor card forgets its children's results", () => {
  let store: StoreApi<StoreState>;
  const stopped = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
    id,
    name: id,
    model: 'm',
    provider: 'claude',
    status: 'idle',
    startedAt: 1,
    finishedAt: 2,
    ...extra,
  });

  beforeEach(() => {
    vi.mocked(forgetSupervisorRunResults).mockClear();
    store = createStore<StoreState>()(
      (...args) =>
        createAgentSlice(...(args as Parameters<typeof createAgentSlice>)) as unknown as StoreState
    );
  });

  it('forgets them when the stopped supervisor is dismissed', () => {
    store.setState({ agents: [stopped('sup', { role: 'supervisor' })] });
    store.getState().dismissFinishedAgent('sup');
    expect(forgetSupervisorRunResults).toHaveBeenCalledWith('sup');
  });

  it('leaves them alone when an ordinary agent or a child is dismissed', () => {
    store.setState({
      agents: [stopped('plain'), stopped('child', { spawnedByAgentId: 'sup' })],
    });
    store.getState().dismissFinishedAgent('plain');
    store.getState().dismissFinishedAgent('child');
    expect(forgetSupervisorRunResults).not.toHaveBeenCalled();
  });

  it('forgets them when the supervisor falls out of the finished list', () => {
    const finished = Array.from({ length: 20 }, (_, i) =>
      stopped(`done-${i}`, { startedAt: 10 + i })
    );
    store.setState({
      agents: [
        stopped('sup', { role: 'supervisor', startedAt: 0 }),
        ...finished,
        { ...stopped('last', { startedAt: 99 }), status: 'running', finishedAt: undefined },
      ],
    });
    store.getState().updateAgentStatus('last', 'idle');
    expect(store.getState().agents.some((a) => a.id === 'sup')).toBe(false);
    expect(forgetSupervisorRunResults).toHaveBeenCalledWith('sup');
  });
});

describe('spawnLinkedSupervisor (supervisor link)', () => {
  let store: StoreApi<StoreState>;

  beforeEach(() => {
    vi.mocked(spawnAgent).mockClear();
    store = createStore<StoreState>()(
      (...args) =>
        ({
          ...createAgentSlice(...(args as Parameters<typeof createAgentSlice>)),
          providers: [CLAUDE],
          starredProjects: [],
          rootPath: null,
        }) as unknown as StoreState
    );
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });
  });

  it('starts a new supervisor with the task even while one is running', async () => {
    store.setState({
      agents: [
        {
          id: 'sup-0',
          name: 'Supervisor',
          model: 'sonnet',
          provider: 'claude',
          status: 'running',
          startedAt: 1,
          role: 'supervisor',
        },
      ],
    });

    const launch = await store.getState().spawnLinkedSupervisor({ task: 'plan the export' });

    expect(launch.kind).toBe('spawned');
    const config = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(config).toMatchObject({ role: 'supervisor', provider: 'claude', headless: false });
    expect(config.task).toContain('plan the export');
  });

  it('refuses a provider the supervisor policy does not list', async () => {
    const launch = await store.getState().spawnLinkedSupervisor({ provider: 'codex' });
    expect(launch).toEqual({
      kind: 'provider-not-allowed',
      provider: 'codex',
      allowed: ['claude'],
    });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('starts nothing while the policy shows no project', async () => {
    vi.mocked(supervisorPolicyGet).mockResolvedValue({
      policy: emptySupervisorPolicy(),
      rejected: [],
    });
    expect(await store.getState().spawnLinkedSupervisor({})).toEqual({ kind: 'nothing-visible' });
    expect(spawnAgent).not.toHaveBeenCalled();
  });
});

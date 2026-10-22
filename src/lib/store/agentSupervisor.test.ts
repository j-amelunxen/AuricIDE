import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createAgentSlice } from './agentSlice';
import type { StoreState } from './index';
import { forgetSupervisorRunResults, spawnAgent, type AgentInfo } from '../tauri/agents';
import { supervisorPolicyGet } from '../tauri/supervisorPolicy';
import { emptySupervisorPolicy, defaultSupervisorProjectPolicy } from '../config/supervisorPolicy';
import type { ProviderInfo } from '../tauri/providers';
import {
  managerInstructions,
  managerMemory,
  supervisorManagersList,
} from '../tauri/supervisorManagers';

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
vi.mock('../tauri/supervisorManagers', () => ({
  supervisorManagersList: vi.fn(async () => []),
  managerInstructions: vi.fn(async () => null),
  managerMemory: vi.fn(async () => {
    throw new Error('no memory yet');
  }),
}));
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

  it('resumes an earlier run in a new supervisor, even while another one runs', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });
    const folder = '/home/me/.auric/supervisors/2026-10-16_185017';
    const sendAgentInput = vi.fn();
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
          repoPath: '/home/me/.auric/supervisors/2026-10-20_080000',
        },
      ],
      sendAgentInput,
    } as Partial<StoreState>);

    const launch = await store.getState().spawnSupervisor({ task: '', resumeRunDir: folder });

    expect(launch.kind).toBe('spawned');
    const config = vi.mocked(spawnAgent).mock.calls[0][0];
    expect(config.resumeRunDir).toBe(folder);
    expect(config.task).toContain('## Picking up an earlier run');
    expect(sendAgentInput).not.toHaveBeenCalled();
  });

  it('refuses to resume a run folder a live supervisor already works in, before asking Rust', async () => {
    const folder = '/home/me/.auric/supervisors/2026-10-16_185017';
    const live: AgentInfo = {
      id: 'sup-0',
      name: 'Supervisor',
      model: 'sonnet',
      provider: 'claude',
      status: 'running',
      startedAt: 1,
      role: 'supervisor',
      repoPath: folder,
    };
    store.setState({ agents: [live] });

    expect(
      await store.getState().spawnSupervisor({ task: 'carry on', resumeRunDir: folder })
    ).toEqual({ kind: 'run_in_use', agent: live });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('starts a second supervisor on a skill while one runs, and types nothing into the first', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });
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

    const launch = await store.getState().spawnSupervisor({ task: 'Ask for the build status' });

    expect(launch.kind).toBe('spawned');
    expect(vi.mocked(spawnAgent).mock.calls[0][0].task).toMatch(
      /## Your first task\n\nAsk for the build status$/
    );
    expect(sendAgentInput).not.toHaveBeenCalled();
  });

  it('starts a second supervisor without a task when asked to start a new one', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });
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

    const launch = await store.getState().spawnSupervisor({ task: '', forceNew: true });

    expect(launch.kind).toBe('spawned');
    expect(spawnAgent).toHaveBeenCalledTimes(1);
  });

  it('focuses the newest of several running supervisors on a plain click', async () => {
    const older: AgentInfo = {
      id: 'sup-0',
      name: 'Supervisor',
      model: 'sonnet',
      provider: 'claude',
      status: 'running',
      startedAt: 1,
      role: 'supervisor',
    };
    const newer: AgentInfo = { ...older, id: 'sup-1', name: 'Supervisor 2', startedAt: 5 };
    store.setState({ agents: [newer, older] });
    expect(await store.getState().spawnSupervisor()).toEqual({ kind: 'running', agent: newer });
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

  it('starts the supervisor under the key and name the client chose', async () => {
    await store.getState().spawnLinkedSupervisor({ key: 'mail-triage', name: 'Mail triage' });

    expect(vi.mocked(spawnAgent).mock.calls[0][0]).toMatchObject({
      role: 'supervisor',
      supervisorKey: 'mail-triage',
      name: 'Mail triage',
    });
  });

  it('sends no key when the client chose none', async () => {
    await store.getState().spawnLinkedSupervisor({ task: 'x' });
    expect(vi.mocked(spawnAgent).mock.calls[0][0]).not.toHaveProperty('supervisorKey');
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

  it('refuses a listed provider the supervisor cannot run on, without spawning', async () => {
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    policy.supervisor.providers = ['claude', 'gemini'];
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });

    const launch = await store.getState().spawnLinkedSupervisor({ provider: 'gemini' });

    expect(launch).toEqual({
      kind: 'provider-unsupported',
      provider: 'gemini',
      supported: ['claude', 'codex'],
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

describe('Project Manager launches', () => {
  const FOLDER = '/home/me/.auric/supervisors/2026-10-21_090000';
  const record = {
    key: 'release-desk',
    name: 'Release Desk',
    runDir: '2026-10-21_090000',
    promotedAt: '2026-10-22T10:15:00Z',
    archivedAt: null as string | null,
    lastLaunch: null,
  };
  let store: StoreApi<StoreState>;
  const lastConfig = () => vi.mocked(spawnAgent).mock.calls[0][0];

  beforeEach(() => {
    vi.mocked(spawnAgent).mockClear();
    vi.mocked(supervisorManagersList).mockReset().mockResolvedValue([record]);
    vi.mocked(managerInstructions).mockReset().mockResolvedValue('Write in Spanish.');
    vi.mocked(managerMemory).mockReset().mockRejectedValue(new Error('no memory yet'));
    const policy = emptySupervisorPolicy();
    policy.projects['/work/project-a'] = { ...defaultSupervisorProjectPolicy(), allowed: true };
    vi.mocked(supervisorPolicyGet).mockResolvedValue({ policy, rejected: [] });
    store = createStore<StoreState>()(
      (...args) =>
        ({
          ...createAgentSlice(...(args as Parameters<typeof createAgentSlice>)),
          providers: [CLAUDE],
          starredProjects: [],
          rootPath: null,
        }) as unknown as StoreState
    );
  });

  it('resumes a manager folder as the manager: its name, key, instructions and memory rules', async () => {
    await store.getState().spawnSupervisor({ task: '', resumeRunDir: FOLDER });

    expect(lastConfig()).toMatchObject({
      name: 'Release Desk',
      supervisorKey: 'release-desk',
      resumeRunDir: FOLDER,
    });
    expect(lastConfig().task).toContain('## You are the Project Manager "Release Desk"');
    expect(lastConfig().task).toContain('Write in Spanish.');
    expect(managerInstructions).toHaveBeenCalledWith('release-desk');
  });

  it('puts the last memory check into the prompt', async () => {
    vi.mocked(managerMemory).mockResolvedValue({
      concepts: {},
      deprecated: 0,
      newestChangeMs: null,
      findings: [
        { source: 'layout', code: 'missing_field', path: 'facts/a.md', message: 'no title' },
      ],
      okf: 'ok',
      checkedAt: null,
    });
    await store.getState().spawnSupervisor({ task: '', resumeRunDir: FOLDER });
    expect(lastConfig().task).toContain('- facts/a.md: no title');
  });

  it('starts anyway when the memory summary cannot be read', async () => {
    const launch = await store.getState().spawnSupervisor({ task: '', resumeRunDir: FOLDER });
    expect(launch.kind).toBe('spawned');
    expect(lastConfig().task).not.toContain('## Memory check');
  });

  it('refuses the launch when the instructions cannot be read, rather than start without them', async () => {
    vi.mocked(managerInstructions).mockRejectedValue(
      "INSTRUCTIONS.md of 'Release Desk' is 20000 bytes; the limit is 16384."
    );
    await expect(
      store.getState().spawnSupervisor({ task: '', resumeRunDir: FOLDER })
    ).rejects.toMatch(/limit is 16384/);
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('opens a manager by key: Rust turns the key into a resume of its folder', async () => {
    await store.getState().spawnSupervisor({ task: '', managerKey: 'release-desk' });
    expect(lastConfig()).toMatchObject({ name: 'Release Desk', supervisorKey: 'release-desk' });
    expect(lastConfig()).not.toHaveProperty('resumeRunDir');
  });

  it('hands back the running manager instead of starting a second', async () => {
    const live: AgentInfo = {
      id: 'sup-9',
      name: 'Release Desk',
      model: 'sonnet',
      provider: 'claude',
      status: 'running',
      startedAt: 1,
      role: 'supervisor',
      supervisorKey: 'release-desk',
    };
    store.setState({ agents: [live] });
    expect(
      await store.getState().spawnSupervisor({ task: '', managerKey: 'release-desk' })
    ).toEqual({ kind: 'run_in_use', agent: live });
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('refuses to open a key the registry does not know, with the contract sentence', async () => {
    await expect(
      store.getState().spawnSupervisor({ task: '', managerKey: 'nobody' })
    ).rejects.toThrow("No Project Manager has the key 'nobody'.");
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('refuses to open an archived manager, with the contract sentence', async () => {
    vi.mocked(supervisorManagersList).mockResolvedValue([
      { ...record, archivedAt: '2026-10-23T08:00:00Z' },
    ]);
    await expect(
      store.getState().spawnSupervisor({ task: '', managerKey: 'release-desk' })
    ).rejects.toThrow(
      "The Project Manager 'Release Desk' is archived. Restore it before opening it."
    );
  });

  it('keeps a plain resume plain, and reads no instructions for it', async () => {
    await store
      .getState()
      .spawnSupervisor({ task: '', resumeRunDir: '/home/me/.auric/supervisors/2026-01-01_000000' });
    expect(lastConfig().name).toBe('Supervisor');
    expect(lastConfig().task).toContain('## Picking up an earlier run');
    expect(managerInstructions).not.toHaveBeenCalled();
  });

  it('asks the registry nothing for a brand-new supervisor', async () => {
    await store.getState().spawnSupervisor({ task: 'do it' });
    expect(supervisorManagersList).not.toHaveBeenCalled();
  });

  it('gives a manager launched over the supervisor link its sections, under its key', async () => {
    const launch = await store.getState().spawnLinkedSupervisor({ key: 'release-desk' });
    expect(launch.kind).toBe('spawned');
    expect(lastConfig()).toMatchObject({ name: 'Release Desk', supervisorKey: 'release-desk' });
    expect(lastConfig().task).toContain('Write in Spanish.');
  });

  it('keeps the name a link client chose for a plain keyed supervisor', async () => {
    await store.getState().spawnLinkedSupervisor({ key: 'mail-triage', name: 'Mail triage' });
    expect(lastConfig()).toMatchObject({ name: 'Mail triage', supervisorKey: 'mail-triage' });
    expect(lastConfig().task).not.toContain('Project Manager');
  });
});

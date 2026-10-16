import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import fixtures from './agentControl.fixtures.json';

const { events } = fixtures;

const invokeMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

// The subscription mechanics have their own tests (`subscribe.test.ts`); here
// only which events are routed where matters.
// `onListening` is held back so a test decides when each listener is in place.
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Handler>();
const listening = new Map<string, () => void>();
const unsubscribeMock = vi.fn();
vi.mock('@/lib/tauri/subscribe', () => ({
  subscribeToTauriEvent: (
    name: string,
    handler: Handler,
    _warning: string,
    onListening?: () => void
  ) => {
    listeners.set(name, handler);
    if (onListening) listening.set(name, onListening);
    return unsubscribeMock;
  },
}));

const isDirMock = vi.fn(async (_path: string) => true);
vi.mock('@/lib/tauri/fs', () => ({ isDir: (path: string) => isDirMock(path) }));

const loadSpawnDefaultsMock = vi.fn((_cwd?: string) => null as unknown);
vi.mock('./spawnDefaults', async (original) => ({
  ...(await original<typeof import('./spawnDefaults')>()),
  loadSpawnDefaults: (cwd?: string) => loadSpawnDefaultsMock(cwd),
}));

const { handleControlRequest, installControlBridge } = await import('./controlBridge');
type Host = Parameters<typeof handleControlRequest>[1];

function agent(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    name: id,
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: 1,
    ...extra,
  };
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    agents: [agent('agent-3')],
    providers: [],
    killRunningAgent: vi.fn(async () => undefined),
    spawnNewAgent: vi.fn(async (config: AgentConfig) => agent('agent-4', { name: config.name })),
    recordAgentSentMessage: vi.fn(),
    showToast: vi.fn(() => 0),
    ...overrides,
  };
}

const answered = () =>
  invokeMock.mock.calls
    .filter(([cmd]) => cmd === events.respondCommand)
    .map(([cmd, args]) => ({ cmd, args }));

/** Rust stops waiting 30 s after emitting; these requests are all fresh. */
const fresh = () => Date.now() + fixtures.limits.frontendTimeoutMs;

beforeEach(() => {
  invokeMock.mockClear();
  isDirMock.mockReset().mockResolvedValue(true);
  loadSpawnDefaultsMock.mockReset().mockReturnValue(null);
  listeners.clear();
  listening.clear();
  unsubscribeMock.mockClear();
});

describe('control-request kill', () => {
  it('uses the store kill action and answers killed', async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 'r1', method: 'kill', params: { agentId: 'agent-3' }, expiresAt: fresh() },
      h
    );

    expect(h.killRunningAgent).toHaveBeenCalledWith('agent-3');
    expect(answered()).toEqual([
      {
        cmd: events.respondCommand,
        args: { reqId: 'r1', ok: true, result: { agentId: 'agent-3', killed: true } },
      },
    ]);
  });

  it('answers unknown_agent for an id the store does not know', async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 'r2', method: 'kill', params: { agentId: 'nope' }, expiresAt: fresh() },
      h
    );

    expect(h.killRunningAgent).not.toHaveBeenCalled();
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'unknown_agent' } });
  });
});

describe('control-request spawn', () => {
  const params = {
    projectPath: '/tmp/example-project',
    prompt: 'run the tests',
    provider: null,
    model: null,
    permissionMode: null,
    headless: null,
    name: null,
  };

  it('runs in projectPath with the launch defaults stored for it', async () => {
    loadSpawnDefaultsMock.mockImplementation((cwd?: string) =>
      cwd === '/tmp/example-project'
        ? { providerId: 'codex', model: 'gpt-5', permissionMode: 'plan', headless: true }
        : null
    );
    const h = host();
    await handleControlRequest({ reqId: 'r3', method: 'spawn', params, expiresAt: fresh() }, h);

    expect(h.spawnNewAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'run the tests',
        cwd: '/tmp/example-project',
        projectPath: '/tmp/example-project',
        provider: 'codex',
        model: 'gpt-5',
        permissionMode: 'plan',
        headless: true,
      })
    );
    expect(answered()[0].args).toEqual({ reqId: 'r3', ok: true, result: { agentId: 'agent-4' } });
  });

  it('lets explicit params override the defaults, name included', async () => {
    loadSpawnDefaultsMock.mockReturnValue({
      providerId: 'claude',
      model: 'sonnet',
      permissionMode: 'default',
      headless: false,
    });
    const h = host();
    await handleControlRequest(
      {
        reqId: 'r4',
        method: 'spawn',
        expiresAt: fresh(),
        params: { ...params, model: 'opus', permissionMode: 'plan', headless: true, name: 'Tests' },
      },
      h
    );

    expect(h.spawnNewAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        model: 'opus',
        permissionMode: 'plan',
        headless: true,
        name: 'Tests',
      })
    );
  });

  it('refuses a projectPath that is not a directory as invalid_params', async () => {
    isDirMock.mockResolvedValue(false);
    const h = host();
    await handleControlRequest({ reqId: 'r5', method: 'spawn', params, expiresAt: fresh() }, h);

    expect(h.spawnNewAgent).not.toHaveBeenCalled();
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  for (const refusal of fixtures.spawnRefusals) {
    it(`maps the Rust refusal "${refusal.pattern}" to ${refusal.code}`, async () => {
      const h = host({
        spawnNewAgent: vi.fn(async () => {
          throw new Error(refusal.sample);
        }),
      });
      await handleControlRequest({ reqId: 'r6', method: 'spawn', params, expiresAt: fresh() }, h);

      expect(answered()[0].args).toMatchObject({
        ok: false,
        error: { code: refusal.code, message: refusal.sample },
      });
    });
  }

  it('answers any other spawn failure as internal', async () => {
    const h = host({ spawnNewAgent: vi.fn(async () => Promise.reject('pty exploded')) });
    await handleControlRequest({ reqId: 'r7', method: 'spawn', params, expiresAt: fresh() }, h);

    expect(answered()[0].args).toMatchObject({
      ok: false,
      error: { code: 'internal', message: 'pty exploded' },
    });
  });

  it('answers invalid_params when the params break the contract', async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 'r8', method: 'spawn', params: { projectPath: '/x' }, expiresAt: fresh() },
      h
    );
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });
});

describe('control-request spawn for a supervisor', () => {
  // What Rust emits for a supervisor's child: the policy already decided
  // provider, model and permission mode.
  const child = {
    projectPath: '/tmp/example-project',
    prompt: 'check the parser',
    provider: 'codex',
    model: 'gpt-6-luna',
    permissionMode: null,
    headless: true,
    name: null,
    role: 'worker',
    spawnedByAgentId: 'agent-sup',
    runSource: 'supervisor',
  };

  beforeEach(() => {
    // A folder whose last launch differs in every field the policy decides.
    loadSpawnDefaultsMock.mockReturnValue({
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'bypassPermissions',
      headless: false,
    });
  });

  it("passes a child's provider, model and permission mode through verbatim", async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 's1', method: 'spawn', params: child, expiresAt: fresh() },
      h
    );

    const config = vi.mocked(h.spawnNewAgent).mock.calls[0][0];
    expect(config).toMatchObject({
      task: 'check the parser',
      cwd: '/tmp/example-project',
      projectPath: '/tmp/example-project',
      provider: 'codex',
      model: 'gpt-6-luna',
      headless: true,
      role: 'worker',
      spawnedByAgentId: 'agent-sup',
      runSource: 'supervisor',
    });
    // null is the provider's own default, never the folder's last launch.
    expect(config.permissionMode).toBeUndefined();
    expect(loadSpawnDefaultsMock).not.toHaveBeenCalled();
  });

  it('keeps the permission mode the policy named', async () => {
    const h = host();
    await handleControlRequest(
      {
        reqId: 's2',
        method: 'spawn',
        params: { ...child, permissionMode: 'acceptEdits' },
        expiresAt: fresh(),
      },
      h
    );
    expect(vi.mocked(h.spawnNewAgent).mock.calls[0][0].permissionMode).toBe('acceptEdits');
  });

  it('refuses a child without a model rather than filling one in', async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 's3', method: 'spawn', params: { ...child, model: null }, expiresAt: fresh() },
      h
    );
    expect(h.spawnNewAgent).not.toHaveBeenCalled();
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('says which supervisor started the child', async () => {
    const h = host({ agents: [agent('agent-sup', { name: 'Supervisor', role: 'supervisor' })] });
    await handleControlRequest(
      { reqId: 's4', method: 'spawn', params: child, expiresAt: fresh() },
      h
    );
    expect(h.showToast).toHaveBeenCalledWith(
      expect.stringMatching(/ started by Supervisor$/),
      'success'
    );
  });

  it('starts a supervisor with its role and no launch defaults', async () => {
    const h = host();
    await handleControlRequest(
      {
        reqId: 's5',
        method: 'spawn',
        params: {
          projectPath: '/tmp/example-project',
          prompt: 'supervise',
          provider: 'claude',
          model: 'sonnet',
          role: 'supervisor',
        },
        expiresAt: fresh(),
      },
      h
    );
    expect(vi.mocked(h.spawnNewAgent).mock.calls[0][0]).toMatchObject({
      role: 'supervisor',
      provider: 'claude',
      model: 'sonnet',
      spawnedByAgentId: null,
      headless: false,
    });
    expect(loadSpawnDefaultsMock).not.toHaveBeenCalled();
    expect(h.showToast).toHaveBeenCalledWith(
      expect.stringMatching(/ started by an MCP client$/),
      'success'
    );
  });

  it("starts a supervisor without provider on Claude at that provider's default model", async () => {
    const claude = {
      id: 'claude',
      name: 'Claude',
      models: [],
      permissionModes: [],
      defaultModel: 'sonnet',
      defaultPermissionMode: 'default',
    };
    const h = host({ providers: [claude] });
    await handleControlRequest(
      {
        reqId: 's8',
        method: 'spawn',
        params: { projectPath: '/tmp/example-project', prompt: 'supervise', role: 'supervisor' },
        expiresAt: fresh(),
      },
      h
    );
    expect(vi.mocked(h.spawnNewAgent).mock.calls[0][0]).toMatchObject({
      role: 'supervisor',
      provider: 'claude',
      model: 'sonnet',
    });
    expect(loadSpawnDefaultsMock).not.toHaveBeenCalled();
  });

  it('refuses provenance of the wrong shape as invalid_params', async () => {
    const h = host();
    await handleControlRequest(
      {
        reqId: 's6',
        method: 'spawn',
        params: { ...child, runSource: 'robot' },
        expiresAt: fresh(),
      },
      h
    );
    expect(h.spawnNewAgent).not.toHaveBeenCalled();
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('leaves an ordinary spawn on the launch defaults', async () => {
    const h = host();
    await handleControlRequest(
      {
        reqId: 's7',
        method: 'spawn',
        params: { projectPath: '/tmp/example-project', prompt: 'x', spawnedByAgentId: null },
        expiresAt: fresh(),
      },
      h
    );
    expect(vi.mocked(h.spawnNewAgent).mock.calls[0][0]).toMatchObject({
      provider: 'claude',
      model: 'opus',
    });
    expect(vi.mocked(h.spawnNewAgent).mock.calls[0][0].role).toBeUndefined();
  });
});

describe('expired requests', () => {
  it('answers frontend_unavailable and neither kills nor spawns', async () => {
    const h = host();
    const past = Date.now() - 1;
    await handleControlRequest(
      { reqId: 'r10', method: 'kill', params: { agentId: 'agent-3' }, expiresAt: past },
      h
    );
    await handleControlRequest(
      {
        reqId: 'r11',
        method: 'spawn',
        params: { projectPath: '/tmp/example-project', prompt: 'x' },
        expiresAt: past,
      },
      h
    );

    expect(h.killRunningAgent).not.toHaveBeenCalled();
    expect(h.spawnNewAgent).not.toHaveBeenCalled();
    expect(answered().map(({ args }) => args)).toEqual([
      expect.objectContaining({
        reqId: 'r10',
        ok: false,
        error: expect.objectContaining({ code: 'frontend_unavailable' }),
      }),
      expect.objectContaining({
        reqId: 'r11',
        ok: false,
        error: expect.objectContaining({ code: 'frontend_unavailable' }),
      }),
    ]);
  });
});

describe('installControlBridge', () => {
  const readyCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd === events.readyCommand);

  it('routes both events by their fixture names and unsubscribes on cleanup', async () => {
    const h = host();
    const dispose = installControlBridge(() => h);
    expect([...listeners.keys()].sort()).toEqual(
      [events.agentInputSent, events.controlRequest].sort()
    );

    listeners.get(events.agentInputSent)!({ agentId: 'agent-3', text: 'yes' });
    expect(h.recordAgentSentMessage).toHaveBeenCalledWith('agent-3', 'yes');

    listeners.get(events.controlRequest)!({
      reqId: 'r9',
      method: 'kill',
      params: { agentId: 'agent-3' },
      expiresAt: fresh(),
    });
    await vi.waitFor(() => expect(answered()).toHaveLength(1));

    dispose();
    expect(unsubscribeMock).toHaveBeenCalledTimes(2);
  });

  it('reports ready only once both listeners are in place', async () => {
    installControlBridge(() => host());

    listening.get(events.controlRequest)!();
    await Promise.resolve();
    expect(readyCalls()).toHaveLength(0);

    listening.get(events.agentInputSent)!();
    await vi.waitFor(() => expect(readyCalls()).toHaveLength(1));
  });

  it('reports ready again after a remount', async () => {
    const dispose = installControlBridge(() => host());
    for (const ready of listening.values()) ready();
    await vi.waitFor(() => expect(readyCalls()).toHaveLength(1));
    dispose();
    listening.clear();

    installControlBridge(() => host());
    for (const ready of listening.values()) ready();
    await vi.waitFor(() => expect(readyCalls()).toHaveLength(2));
  });
});

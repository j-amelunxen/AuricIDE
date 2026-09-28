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

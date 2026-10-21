import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import fixtures from './agentControl.fixtures.json';
import linkFixtures from './supervisorLink.fixtures.json';

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

const { handleControlRequest, installControlBridge, WORKTREE_CHILD_NOTE } =
  await import('./controlBridge');
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
    dismissFinishedAgent: vi.fn(),
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

describe('control-request dismiss', () => {
  const dismiss = (h: Host, agentId: string) =>
    handleControlRequest(
      { reqId: 'd1', method: 'dismiss', params: { agentId }, expiresAt: fresh() },
      h
    );

  it('clears a finished agent with the store action and answers dismissed', async () => {
    const h = host({ agents: [agent('agent-5', { status: 'idle' })] });
    await dismiss(h, 'agent-5');

    expect(h.dismissFinishedAgent).toHaveBeenCalledWith('agent-5');
    expect(answered()[0].args).toEqual({
      reqId: 'd1',
      ok: true,
      result: { agentId: 'agent-5', dismissed: true },
    });
  });

  it('refuses a running agent and leaves it alone', async () => {
    const h = host();
    await dismiss(h, 'agent-3');

    expect(h.dismissFinishedAgent).not.toHaveBeenCalled();
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('answers dismissed for a card the human already cleared', async () => {
    const h = host({ agents: [] });
    await dismiss(h, 'agent-5');

    expect(h.dismissFinishedAgent).not.toHaveBeenCalled();
    expect(answered()[0].args).toMatchObject({ ok: true, result: { dismissed: true } });
  });
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

  it("runs a supervisor link job's agent verbatim too, though no supervisor started it", async () => {
    const h = host();
    const job = { ...child, spawnedByAgentId: null, worktree: true };
    await handleControlRequest(
      { reqId: 's8', method: 'spawn', params: job, expiresAt: fresh() },
      h
    );

    const config = vi.mocked(h.spawnNewAgent).mock.calls[0][0];
    expect(config).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-luna',
      headless: true,
      role: 'worker',
      runSource: 'supervisor',
      spawnedByAgentId: null,
      useWorktree: true,
    });
    expect(config.permissionMode).toBeUndefined();
    expect(loadSpawnDefaultsMock).not.toHaveBeenCalled();
  });

  it('starts a child in a worktree and tells it to commit there', async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 's6', method: 'spawn', params: { ...child, worktree: true }, expiresAt: fresh() },
      h
    );

    const config = vi.mocked(h.spawnNewAgent).mock.calls[0][0];
    expect(config.useWorktree).toBe(true);
    expect(config.task).toBe(`check the parser\n\n${WORKTREE_CHILD_NOTE}`);
    // Prompt recall keeps what was asked, not the IDE's own addition.
    expect(config.historyPrompt).toBe('check the parser');
  });

  it('leaves a child without worktree in the project folder, task untouched', async () => {
    const h = host();
    await handleControlRequest(
      { reqId: 's7', method: 'spawn', params: child, expiresAt: fresh() },
      h
    );
    const config = vi.mocked(h.spawnNewAgent).mock.calls[0][0];
    expect(config.useWorktree).toBeUndefined();
    expect(config.task).toBe('check the parser');
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

  it('starts a supervisor the way the tile and the link do, key and first task included', async () => {
    const spawnLinkedSupervisor = vi.fn(async () => ({
      kind: 'spawned' as const,
      agent: agent('agent-9', { name: 'Supervisor', role: 'supervisor' }),
    }));
    const h = host({ spawnLinkedSupervisor });
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
          supervisorKey: 'mail-triage',
        },
        expiresAt: fresh(),
      },
      h
    );
    expect(spawnLinkedSupervisor).toHaveBeenCalledWith({
      task: 'supervise',
      provider: 'claude',
      model: 'sonnet',
      key: 'mail-triage',
      name: null,
    });
    // Not the verbatim path: that one skipped the launch prompt and the policy.
    expect(h.spawnNewAgent).not.toHaveBeenCalled();
    expect(loadSpawnDefaultsMock).not.toHaveBeenCalled();
    expect(answered()[0].args).toEqual({ reqId: 's5', ok: true, result: { agentId: 'agent-9' } });
    expect(h.showToast).toHaveBeenCalledWith('Supervisor started by an MCP client', 'success');
  });

  it("does not ask for the supervisor's project folder to exist: Rust gives it a run folder", async () => {
    isDirMock.mockResolvedValue(false);
    const spawnLinkedSupervisor = vi.fn(async () => ({
      kind: 'spawned' as const,
      agent: agent('agent-9', { role: 'supervisor' }),
    }));
    const h = host({ spawnLinkedSupervisor });
    await handleControlRequest(
      {
        reqId: 's8',
        method: 'spawn',
        params: { projectPath: '/nowhere', prompt: 'supervise', role: 'supervisor' },
        expiresAt: fresh(),
      },
      h
    );
    expect(spawnLinkedSupervisor).toHaveBeenCalledWith({
      task: 'supervise',
      provider: null,
      model: null,
      key: null,
      name: null,
    });
    expect(answered()[0].args).toMatchObject({ ok: true });
  });

  it("answers a supervisor spawn the policy refuses in the socket's own codes", async () => {
    const outcomes = [
      { kind: 'nothing-visible' as const },
      { kind: 'provider-not-allowed' as const, provider: 'codex', allowed: ['claude'] },
      { kind: 'provider-unsupported' as const, provider: 'gemini', supported: ['claude'] },
    ];
    for (const [i, outcome] of outcomes.entries()) {
      const h = host({ spawnLinkedSupervisor: vi.fn(async () => outcome) });
      await handleControlRequest(
        {
          reqId: `r${i}`,
          method: 'spawn',
          params: { projectPath: '/tmp/example-project', prompt: 'x', role: 'supervisor' },
          expiresAt: fresh(),
        },
        h
      );
    }
    expect(answered().map(({ args }) => args)).toMatchObject([
      { reqId: 'r0', ok: false, error: { code: 'invalid_params' } },
      { reqId: 'r1', ok: false, error: { code: 'invalid_params' } },
      { reqId: 'r2', ok: false, error: { code: 'invalid_params' } },
    ]);
  });

  it("maps Rust's refusal of a taken key onto supervisor_key_in_use", async () => {
    const [refusal] = fixtures.spawnRefusals.filter((r) => r.code === 'supervisor_key_in_use');
    const h = host({
      spawnLinkedSupervisor: vi.fn(async () => {
        throw new Error(refusal.sample);
      }),
    });
    await handleControlRequest(
      {
        reqId: 's9',
        method: 'spawn',
        params: {
          projectPath: '/tmp/example-project',
          prompt: 'x',
          role: 'supervisor',
          supervisorKey: 'mail-triage',
        },
        expiresAt: fresh(),
      },
      h
    );
    expect(answered()[0].args).toMatchObject({
      ok: false,
      error: { code: 'supervisor_key_in_use', message: refusal.sample },
    });
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

describe('control-request spawn_supervisor (supervisor link)', () => {
  const spawned = agent('agent-7', { name: 'Supervisor', role: 'supervisor' });

  it('starts a supervisor through the store and answers its id', async () => {
    const spawnLinkedSupervisor = vi.fn(async () => ({ kind: 'spawned' as const, agent: spawned }));
    const h = host({ spawnLinkedSupervisor });
    await handleControlRequest(
      {
        reqId: 'l1',
        method: 'spawn_supervisor',
        params: { task: 'plan the export' },
        expiresAt: fresh(),
      },
      h
    );

    expect(spawnLinkedSupervisor).toHaveBeenCalledWith({ task: 'plan the export' });
    expect(answered()[0].args).toEqual({ reqId: 'l1', ok: true, result: { agentId: 'agent-7' } });
  });

  it('carries the supervisor key the link asked for', async () => {
    const spawnLinkedSupervisor = vi.fn(async () => ({
      kind: 'spawned' as const,
      agent: { ...spawned, supervisorKey: 'mail-triage' },
    }));
    const h = host({ spawnLinkedSupervisor });
    await handleControlRequest(
      {
        reqId: 'l6',
        method: 'spawn_supervisor',
        params: { supervisorKey: 'mail-triage', task: 'triage' },
        expiresAt: fresh(),
      },
      h
    );

    expect(spawnLinkedSupervisor).toHaveBeenCalledWith({ key: 'mail-triage', task: 'triage' });
    expect(answered()[0].args).toMatchObject({ ok: true, result: { agentId: 'agent-7' } });
  });

  it('reads every spawn_supervisor shape Rust forwards and answers { agentId }', async () => {
    const { method, cases, answer } = linkFixtures.frontendSpawnSupervisor;
    for (const [i, { name, frontend }] of cases.entries()) {
      invokeMock.mockClear();
      const spawnLinkedSupervisor = vi.fn(async () => ({
        kind: 'spawned' as const,
        agent: agent(answer.agentId, { role: 'supervisor' }),
      }));
      await handleControlRequest(
        {
          reqId: `f${i}`,
          method: method as 'spawn_supervisor',
          params: frontend,
          expiresAt: fresh(),
        },
        host({ spawnLinkedSupervisor })
      );
      const { supervisorKey, ...rest } = frontend as { supervisorKey?: string };
      expect(spawnLinkedSupervisor, name).toHaveBeenCalledWith(
        supervisorKey ? { ...rest, key: supervisorKey } : rest
      );
      expect(answered()[0].args, name).toEqual({ reqId: `f${i}`, ok: true, result: answer });
    }
  });

  it("maps Rust's refusal of a key taken meanwhile onto supervisor_key_in_use", async () => {
    // Rust answers a lost key race with the winner only when it reads this code;
    // `internal` would hand the client an error. Tauri rejects with a plain string.
    const [refusal] = fixtures.spawnRefusals.filter((r) => r.code === 'supervisor_key_in_use');
    const h = host({
      spawnLinkedSupervisor: vi.fn(async () => {
        throw refusal.sample;
      }),
    });
    await handleControlRequest(
      {
        reqId: 'l8',
        method: 'spawn_supervisor',
        params: { supervisorKey: 'mail-triage' },
        expiresAt: fresh(),
      },
      h
    );
    expect(answered()[0].args).toMatchObject({
      ok: false,
      error: { code: 'supervisor_key_in_use', message: refusal.sample },
    });
  });

  it('refuses `if`: Rust settles it and never forwards it', async () => {
    const spawnLinkedSupervisor = vi.fn();
    const h = host({ spawnLinkedSupervisor });
    await handleControlRequest(
      {
        reqId: 'l7',
        method: 'spawn_supervisor',
        params: { supervisorKey: 'mail-triage', if: 'existing' },
        expiresAt: fresh(),
      },
      h
    );
    expect(answered()[0].args).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(spawnLinkedSupervisor).not.toHaveBeenCalled();
  });

  it('answers supervisor_unavailable when the policy shows no project', async () => {
    const h = host({
      spawnLinkedSupervisor: vi.fn(async () => ({ kind: 'nothing-visible' as const })),
    });
    await handleControlRequest(
      { reqId: 'l2', method: 'spawn_supervisor', params: {}, expiresAt: fresh() },
      h
    );

    expect(answered()[0].args).toMatchObject({
      ok: false,
      error: { code: 'supervisor_unavailable' },
    });
  });

  it('answers provider_unsupported for a listed provider the supervisor cannot run on', async () => {
    const h = host({
      spawnLinkedSupervisor: vi.fn(async () => ({
        kind: 'provider-unsupported' as const,
        provider: 'gemini',
        supported: ['claude', 'codex'],
      })),
    });
    await handleControlRequest(
      {
        reqId: 'l5',
        method: 'spawn_supervisor',
        params: { provider: 'gemini' },
        expiresAt: fresh(),
      },
      h
    );

    expect(answered()[0].args).toMatchObject({
      reqId: 'l5',
      ok: false,
      error: { code: 'provider_unsupported' },
    });
    expect(String((answered()[0].args as { error: { message: string } }).error.message)).toContain(
      'gemini'
    );
  });

  it('refuses a provider the policy does not list, and unknown params', async () => {
    const h = host({
      spawnLinkedSupervisor: vi.fn(async () => ({
        kind: 'provider-not-allowed' as const,
        provider: 'codex',
        allowed: ['claude'],
      })),
    });
    await handleControlRequest(
      {
        reqId: 'l3',
        method: 'spawn_supervisor',
        params: { provider: 'codex' },
        expiresAt: fresh(),
      },
      h
    );
    await handleControlRequest(
      { reqId: 'l4', method: 'spawn_supervisor', params: { role: 'worker' }, expiresAt: fresh() },
      h
    );

    expect(answered().map(({ args }) => args)).toMatchObject([
      { reqId: 'l3', ok: false, error: { code: 'invalid_params' } },
      { reqId: 'l4', ok: false, error: { code: 'invalid_params' } },
    ]);
    expect(h.spawnLinkedSupervisor).toHaveBeenCalledTimes(1);
  });
});

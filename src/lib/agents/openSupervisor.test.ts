import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openManager, openSupervisor, resumeSupervisor } from './openSupervisor';
import type { AgentInfo } from '@/lib/tauri/agents';
import { updateManagerPresentation } from '@/lib/quickAccess/managerPresentation';

type SupervisorStore = Parameters<typeof openSupervisor>[0];
type ManagerStore = Parameters<typeof openManager>[0];

describe('openSupervisor', () => {
  const dummyAgent: AgentInfo = {
    id: 'agent-123',
    name: 'supervisor-1',
    status: 'running',
    model: 'sonnet',
    startedAt: 1000,
    provider: 'claude',
    role: 'supervisor',
  };

  it('navigates to settings and toasts when result is nothing-visible', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'nothing-visible' }),
      showToast: vi.fn(),
    };
    const hooks = {
      onNothingVisible: vi.fn(),
      onShow: vi.fn(),
    };

    await openSupervisor(store, undefined, hooks);

    expect(hooks.onNothingVisible).toHaveBeenCalled();
    expect(hooks.onShow).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(
      'Allow at least one project for the supervisor first',
      'info'
    );
  });

  it('returns quietly when result is cancelled', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'cancelled' }),
      showToast: vi.fn(),
    };
    const hooks = {
      onNothingVisible: vi.fn(),
      onShow: vi.fn(),
    };

    await openSupervisor(store, undefined, hooks);

    expect(hooks.onNothingVisible).not.toHaveBeenCalled();
    expect(hooks.onShow).not.toHaveBeenCalled();
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('starts a new supervisor for a skill, without a toast, and shows it', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'spawned', agent: dummyAgent }),
      showToast: vi.fn(),
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };

    await openSupervisor(store, { id: 'skill-1', label: 'Build status', prompt: 'Ask' }, hooks);

    expect(store.spawnSupervisor).toHaveBeenCalledWith({ task: 'Ask', model: undefined });
    expect(hooks.onShow).toHaveBeenCalledWith('agent-123');
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('asks for a new supervisor without a skill when told to start a new one', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'spawned', agent: dummyAgent }),
      showToast: vi.fn(),
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };

    await openSupervisor(store, undefined, hooks, { forceNew: true });

    expect(store.spawnSupervisor).toHaveBeenCalledWith({ task: '', forceNew: true });
    expect(hooks.onShow).toHaveBeenCalledWith('agent-123');
  });

  it('shows the running supervisor on a plain open', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'running', agent: dummyAgent }),
      showToast: vi.fn(),
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };

    await openSupervisor(store, undefined, hooks);

    expect(store.spawnSupervisor).toHaveBeenCalledWith(undefined);
    expect(hooks.onShow).toHaveBeenCalledWith('agent-123');
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('calls onShow when result is spawned', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'spawned', agent: dummyAgent }),
      showToast: vi.fn(),
    };
    const hooks = {
      onNothingVisible: vi.fn(),
      onShow: vi.fn(),
    };

    await openSupervisor(store, undefined, hooks);

    expect(hooks.onShow).toHaveBeenCalledWith('agent-123');
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('toasts error if spawnSupervisor rejects', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockRejectedValue(new Error('Spawn failed')),
      showToast: vi.fn(),
    };
    const hooks = {
      onNothingVisible: vi.fn(),
      onShow: vi.fn(),
    };

    await openSupervisor(store, undefined, hooks);

    expect(hooks.onShow).not.toHaveBeenCalled();
    expect(store.showToast).toHaveBeenCalledWith(
      'Could not start the supervisor: Spawn failed',
      'error'
    );
  });
});

describe('resumeSupervisor', () => {
  const agent: AgentInfo = {
    id: 'agent-9',
    name: 'Supervisor',
    status: 'running',
    model: 'sonnet',
    startedAt: 1,
    provider: 'claude',
    role: 'supervisor',
  };
  const folder = '/home/me/.auric/supervisors/2026-10-16_185017';

  it('starts a supervisor in the earlier folder and shows it', async () => {
    const store = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'spawned', agent }),
      showToast: vi.fn(),
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };
    await resumeSupervisor(store, folder, hooks);
    expect(store.spawnSupervisor).toHaveBeenCalledWith({ task: '', resumeRunDir: folder });
    expect(hooks.onShow).toHaveBeenCalledWith('agent-9');
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('starts the resume even while another supervisor runs', async () => {
    const store = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'spawned', agent }),
      showToast: vi.fn(),
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };
    await resumeSupervisor(store, folder, hooks);
    expect(store.showToast).not.toHaveBeenCalled();
    expect(hooks.onShow).toHaveBeenCalledWith('agent-9');
  });

  it('says which supervisor already works in that run, and shows it', async () => {
    const store = {
      spawnSupervisor: vi
        .fn()
        .mockResolvedValue({ kind: 'run_in_use', agent: { ...agent, name: 'Supervisor 2' } }),
      showToast: vi.fn(),
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };
    await resumeSupervisor(store, folder, hooks);
    expect(store.showToast).toHaveBeenCalledWith(
      'This run is already open in "Supervisor 2".',
      'info'
    );
    expect(hooks.onShow).toHaveBeenCalledWith('agent-9');
  });

  it("passes Rust's refusal on as a toast", async () => {
    const store = {
      spawnSupervisor: vi.fn().mockRejectedValue(new Error("'/x' is not a supervisor run folder.")),
      showToast: vi.fn(),
    };
    await resumeSupervisor(store, '/x', { onNothingVisible: vi.fn(), onShow: vi.fn() });
    expect(store.showToast).toHaveBeenCalledWith(
      "Could not resume the supervisor: '/x' is not a supervisor run folder.",
      'error'
    );
  });
});

describe('openManager', () => {
  const agent: AgentInfo = {
    id: 'agent-4',
    name: 'Release Desk',
    status: 'running',
    model: 'sonnet',
    startedAt: 1,
    provider: 'claude',
    role: 'supervisor',
    supervisorKey: 'release-desk',
  };
  const setup = (result: unknown) => {
    const store: ManagerStore = {
      spawnSupervisor: vi.fn().mockResolvedValue(result),
      showToast: vi.fn(),
      sendAgentInput: vi.fn().mockResolvedValue(undefined),
      agents: [],
    };
    return { store, hooks: { onNothingVisible: vi.fn(), onShow: vi.fn() } };
  };

  it('opens the manager by key, never as a new supervisor', async () => {
    const { store, hooks } = setup({ kind: 'spawned', agent });
    await openManager(store, 'release-desk', hooks);
    expect(store.spawnSupervisor).toHaveBeenCalledWith({ task: '', managerKey: 'release-desk' });
    expect(hooks.onShow).toHaveBeenCalledWith('agent-4');
  });

  it('brings the live manager forward without a toast', async () => {
    const { store, hooks } = setup({ kind: 'run_in_use', agent });
    await openManager(store, 'release-desk', hooks);
    expect(hooks.onShow).toHaveBeenCalledWith('agent-4');
    expect(store.showToast).not.toHaveBeenCalled();
  });

  it('sends the human to Settings when no project is allowed', async () => {
    const { store, hooks } = setup({ kind: 'nothing-visible' });
    await openManager(store, 'release-desk', hooks);
    expect(hooks.onNothingVisible).toHaveBeenCalled();
    expect(hooks.onShow).not.toHaveBeenCalled();
  });

  it('says why a refusal from the registry stopped it, in its own words', async () => {
    const store: ManagerStore = {
      spawnSupervisor: vi
        .fn()
        .mockRejectedValue(
          "The Project Manager 'Release Desk' is archived. Restore it before opening it."
        ),
      showToast: vi.fn(),
      sendAgentInput: vi.fn(),
      agents: [],
    };
    const hooks = { onNothingVisible: vi.fn(), onShow: vi.fn() };
    await openManager(store, 'release-desk', hooks);
    expect(store.showToast).toHaveBeenCalledWith(
      "Could not open the Project Manager: The Project Manager 'Release Desk' is archived. Restore it before opening it.",
      'error'
    );
    expect(hooks.onShow).not.toHaveBeenCalled();
  });

  it('returns quietly when the provider choice was cancelled', async () => {
    const { store, hooks } = setup({ kind: 'cancelled' });
    await openManager(store, 'release-desk', hooks);
    expect(hooks.onShow).not.toHaveBeenCalled();
    expect(store.showToast).not.toHaveBeenCalled();
  });
  describe('with a task', () => {
    const task = 'Check the open release tickets';

    it('types it into the running manager as one message with Enter, and brings it forward', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      await openManager(store, 'release-desk', hooks, { task });
      expect(store.sendAgentInput).toHaveBeenCalledWith('agent-4', `${task}\r`);
      expect(store.spawnSupervisor).not.toHaveBeenCalled();
      expect(hooks.onShow).toHaveBeenCalledWith('agent-4');
    });

    it('trims the task before it is sent', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      await openManager(store, 'release-desk', hooks, { task: `  ${task}\n ` });
      expect(store.sendAgentInput).toHaveBeenCalledWith('agent-4', `${task}\r`);
    });

    it('hands it to a stopped manager as the first task of the resume', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [{ ...agent, status: 'idle' }];
      await openManager(store, 'release-desk', hooks, { task });
      expect(store.spawnSupervisor).toHaveBeenCalledWith({ task, managerKey: 'release-desk' });
      expect(store.sendAgentInput).not.toHaveBeenCalled();
    });

    it('still delivers it when the manager started between the check and the launch', async () => {
      const { store, hooks } = setup({ kind: 'run_in_use', agent });
      await openManager(store, 'release-desk', hooks, { task });
      expect(store.sendAgentInput).toHaveBeenCalledWith('agent-4', `${task}\r`);
      expect(hooks.onShow).toHaveBeenCalledWith('agent-4');
    });

    it('says so when the message could not be typed in, and does not show the agent', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      vi.mocked(store.sendAgentInput).mockRejectedValue(new Error('pty closed'));
      await openManager(store, 'release-desk', hooks, { task });
      expect(store.showToast).toHaveBeenCalledWith(
        'Could not send the task to Release Desk: pty closed',
        'error'
      );
      expect(hooks.onShow).not.toHaveBeenCalled();
    });

    it.each(['', '   ', '\n\t'])('treats %j as no task', async (blank) => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      await openManager(store, 'release-desk', hooks, { task: blank });
      expect(store.sendAgentInput).not.toHaveBeenCalled();
      expect(hooks.onShow).toHaveBeenCalledWith('agent-4');
    });
  });

  describe('with a model', () => {
    beforeEach(() => localStorage.clear());

    it('launches on the model the caller names', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      await openManager(store, 'release-desk', hooks, { model: 'haiku' });
      expect(store.spawnSupervisor).toHaveBeenCalledWith({
        task: '',
        managerKey: 'release-desk',
        model: 'haiku',
      });
    });

    it("falls back to the manager's presentation model when the caller names none", async () => {
      updateManagerPresentation('release-desk', { model: 'sonnet' });
      const { store, hooks } = setup({ kind: 'spawned', agent });
      await openManager(store, 'release-desk', hooks);
      expect(store.spawnSupervisor).toHaveBeenCalledWith({
        task: '',
        managerKey: 'release-desk',
        model: 'sonnet',
      });
    });

    it('prefers the caller over the stored model', async () => {
      updateManagerPresentation('release-desk', { model: 'sonnet' });
      const { store, hooks } = setup({ kind: 'spawned', agent });
      await openManager(store, 'release-desk', hooks, { model: 'haiku' });
      expect(store.spawnSupervisor).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'haiku' })
      );
    });
  });
  describe('without a click (automatic)', () => {
    beforeEach(() => localStorage.clear());

    const task = 'Check the open release tickets';

    it('types the task in as automatic text', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      const outcome = await openManager(store, 'release-desk', hooks, { task, automatic: true });
      expect(store.sendAgentInput).toHaveBeenCalledWith('agent-4', `${task}\r`, {
        automatic: true,
      });
      expect(outcome).toBe('opened');
    });

    it('does nothing at all while the human is drafting: no toast, not shown, declined', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      vi.mocked(store.sendAgentInput).mockRejectedValue(
        'The human is typing in this terminal; the message was not sent.'
      );
      const outcome = await openManager(store, 'release-desk', hooks, { task, automatic: true });
      expect(outcome).toBe('declined');
      expect(store.showToast).not.toHaveBeenCalled();
      expect(hooks.onShow).not.toHaveBeenCalled();
    });

    it('still reports any other failure', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      vi.mocked(store.sendAgentInput).mockRejectedValue(new Error('pty closed'));
      const outcome = await openManager(store, 'release-desk', hooks, { task, automatic: true });
      expect(outcome).toBe('failed');
      expect(store.showToast).toHaveBeenCalledWith(
        'Could not send the task to Release Desk: pty closed',
        'error'
      );
    });

    it('asks the launch not to open a dialog, and is declined when it would have needed one', async () => {
      const { store, hooks } = setup({ kind: 'cancelled' });
      const outcome = await openManager(store, 'release-desk', hooks, { task, automatic: true });
      expect(store.spawnSupervisor).toHaveBeenCalledWith({
        task,
        managerKey: 'release-desk',
        automatic: true,
      });
      expect(outcome).toBe('declined');
      expect(store.showToast).not.toHaveBeenCalled();
    });

    it('a click is never declined for drafting: it sends without the automatic flag', async () => {
      const { store, hooks } = setup({ kind: 'spawned', agent });
      store.agents = [agent];
      await openManager(store, 'release-desk', hooks, { task });
      expect(vi.mocked(store.sendAgentInput).mock.calls[0]).toHaveLength(2);
    });
  });

  describe('while a start for the same key is in flight', () => {
    const deferred = () => {
      let resolve: (value: unknown) => void = () => undefined;
      const promise = new Promise((r) => (resolve = r));
      return { promise, resolve };
    };

    it('delivers an Ask after the start finished, as a message to the manager that came up', async () => {
      const start = deferred();
      const { store, hooks } = setup(undefined);
      vi.mocked(store.spawnSupervisor).mockReturnValue(start.promise as never);
      const first = openManager(store, 'release-desk', hooks);
      const ask = openManager(store, 'release-desk', hooks, { task: 'Task B' });
      await Promise.resolve();
      expect(store.sendAgentInput).not.toHaveBeenCalled();

      start.resolve({ kind: 'spawned', agent });
      await Promise.all([first, ask]);
      expect(store.spawnSupervisor).toHaveBeenCalledTimes(1);
      expect(store.sendAgentInput).toHaveBeenCalledWith('agent-4', 'Task B\r');
    });

    it('starts only one supervisor for two Opens', async () => {
      const start = deferred();
      const { store, hooks } = setup(undefined);
      vi.mocked(store.spawnSupervisor).mockReturnValue(start.promise as never);
      const both = Promise.all([
        openManager(store, 'release-desk', hooks),
        openManager(store, 'release-desk', hooks),
      ]);
      start.resolve({ kind: 'spawned', agent });
      await both;
      expect(store.spawnSupervisor).toHaveBeenCalledTimes(1);
      expect(hooks.onShow).toHaveBeenCalledTimes(2);
    });

    it('lets a second call start its own when the first start came to nothing', async () => {
      const { store, hooks } = setup(undefined);
      vi.mocked(store.spawnSupervisor)
        .mockResolvedValueOnce({ kind: 'cancelled' })
        .mockResolvedValueOnce({ kind: 'spawned', agent });
      await Promise.all([
        openManager(store, 'release-desk', hooks),
        openManager(store, 'release-desk', hooks),
      ]);
      expect(store.spawnSupervisor).toHaveBeenCalledTimes(2);
    });

    it('does not hold back another manager', async () => {
      const start = deferred();
      const { store, hooks } = setup(undefined);
      vi.mocked(store.spawnSupervisor)
        .mockReturnValueOnce(start.promise as never)
        .mockResolvedValueOnce({ kind: 'spawned', agent: { ...agent, id: 'agent-9' } });
      const first = openManager(store, 'release-desk', hooks);
      await openManager(store, 'other-desk', hooks);
      expect(hooks.onShow).toHaveBeenCalledWith('agent-9');
      start.resolve({ kind: 'spawned', agent });
      await first;
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { openSupervisor, resumeSupervisor } from './openSupervisor';
import type { AgentInfo } from '@/lib/tauri/agents';

type SupervisorStore = Parameters<typeof openSupervisor>[0];

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

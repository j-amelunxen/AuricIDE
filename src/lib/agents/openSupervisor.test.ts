import { describe, expect, it, vi } from 'vitest';
import { openSupervisor } from './openSupervisor';
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

  it('shows toast and calls onShow when result is sent', async () => {
    const store: SupervisorStore = {
      spawnSupervisor: vi.fn().mockResolvedValue({ kind: 'sent', agent: dummyAgent }),
      showToast: vi.fn(),
    };
    const hooks = {
      onNothingVisible: vi.fn(),
      onShow: vi.fn(),
    };

    await openSupervisor(store, undefined, hooks);

    expect(hooks.onShow).toHaveBeenCalledWith('agent-123');
    expect(store.showToast).toHaveBeenCalledWith(expect.stringContaining('Sent'), 'success');
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

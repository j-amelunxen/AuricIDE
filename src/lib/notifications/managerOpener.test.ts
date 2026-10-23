import { describe, expect, it, vi } from 'vitest';
import type { StoreState } from '@/lib/store';

const mockOpenManager = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/agents/openSupervisor', () => ({
  openManager: (...args: unknown[]) => mockOpenManager(...args),
}));

import { managerOpener } from './managerOpener';

const state = (over: Partial<StoreState> = {}) =>
  ({ selectAgent: vi.fn(), agents: [], ...over }) as unknown as StoreState;

describe('managerOpener', () => {
  it('opens through the one open verb with the options it was given', async () => {
    const current = state();
    await managerOpener(() => current, { show: true })('release-desk', { task: 'Check tickets' });
    expect(mockOpenManager).toHaveBeenCalledWith(
      current,
      'release-desk',
      expect.objectContaining({ onShow: expect.any(Function) }),
      { task: 'Check tickets', automatic: false }
    );
  });

  it('marks an automatic start, so the task is sent as automatic text and no dialog opens', async () => {
    await managerOpener(() => state(), { show: false })('release-desk', { task: 'Check tickets' });
    expect(mockOpenManager.mock.lastCall?.[3]).toEqual({ task: 'Check tickets', automatic: true });
  });

  it('returns what the open verb came to, so the caller can leave a declined reminder unread', async () => {
    mockOpenManager.mockResolvedValueOnce('declined' as never);
    expect(await managerOpener(() => state(), { show: false })('release-desk', {})).toBe(
      'declined'
    );
  });

  it('reads the store at the moment of the call, so the fleet is current', async () => {
    let current = state({ agents: [] });
    const open = managerOpener(() => current, { show: true });
    current = state({ agents: [{ id: 'agent-4' } as StoreState['agents'][number]] });
    await open('release-desk', {});
    expect(mockOpenManager.mock.lastCall?.[0]).toBe(current);
  });

  it('selects the agent after a click', async () => {
    const current = state();
    await managerOpener(() => current, { show: true })('release-desk', {});
    const hooks = mockOpenManager.mock.lastCall?.[2] as { onShow: (id: string) => void };
    hooks.onShow('agent-4');
    expect(current.selectAgent).toHaveBeenCalledWith('agent-4');
  });

  it('leaves the terminal alone for an automatic start', async () => {
    const current = state();
    await managerOpener(() => current, { show: false })('release-desk', {});
    const hooks = mockOpenManager.mock.lastCall?.[2] as { onShow: (id: string) => void };
    hooks.onShow('agent-4');
    expect(current.selectAgent).not.toHaveBeenCalled();
  });
});

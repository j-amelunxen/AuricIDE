import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAgentEvent } from './agentLog';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

const event: PersistedAgentEvent = {
  agentId: 'agent-1',
  agentName: 'Refactor the parser',
  repoPath: '/workspace/sample-repo',
  kind: 'edit',
  label: 'Edited a file',
  path: 'src/main.ts',
  at: 1_700_000_000_000,
  seq: 3,
};

describe('agent log IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agentLogAppend sends the events under one batch argument', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    const { agentLogAppend } = await import('./agentLog');
    await agentLogAppend([event]);

    expect(mockInvoke).toHaveBeenCalledWith('agent_log_append', { events: [event] });
  });

  it('agentLogLoad passes the limit and returns the stored events', async () => {
    mockInvoke.mockResolvedValueOnce([event]);

    const { agentLogLoad } = await import('./agentLog');

    await expect(agentLogLoad(500)).resolves.toEqual([event]);
    expect(mockInvoke).toHaveBeenCalledWith('agent_log_load', { limit: 500 });
  });

  it('agentLogPrune passes both bounds and returns how many rows went', async () => {
    mockInvoke.mockResolvedValueOnce(12);

    const { agentLogPrune } = await import('./agentLog');

    await expect(agentLogPrune(7, 200_000)).resolves.toBe(12);
    expect(mockInvoke).toHaveBeenCalledWith('agent_log_prune', {
      retentionDays: 7,
      maxRows: 200_000,
    });
  });

  it('agentLogPurge takes no arguments', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    const { agentLogPurge } = await import('./agentLog');
    await agentLogPurge();

    expect(mockInvoke).toHaveBeenCalledWith('agent_log_purge', undefined);
  });
});

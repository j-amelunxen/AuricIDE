import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usageRow } from '@/lib/pm/usage/testRow';

const mockInvoke = vi.fn();
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: unknown[]) => mockListen(...args) }));

import { agentUsageLoad, onAgentUsageRecorded } from './agentUsage';

describe('agentUsage IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  it('asks agent_usage_load for the project and returns its rows', async () => {
    const rows = [usageRow({ id: 'a' })];
    mockInvoke.mockResolvedValue(rows);

    await expect(agentUsageLoad('/p')).resolves.toEqual(rows);

    expect(mockInvoke).toHaveBeenCalledWith('agent_usage_load', { projectPath: '/p' });
  });

  it('listens to agent-usage-recorded and hands over the event payload', async () => {
    const callback = vi.fn();
    onAgentUsageRecorded(callback);
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    expect(mockListen.mock.calls[0][0]).toBe('agent-usage-recorded');

    const payload = { projectPath: '/p', row: usageRow({ id: 'a' }) };
    (mockListen.mock.calls[0][1] as (event: { payload: unknown }) => void)({ payload });

    expect(callback).toHaveBeenCalledWith(payload);
  });
});

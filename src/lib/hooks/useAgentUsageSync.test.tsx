import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usageRow } from '@/lib/pm/usage/testRow';
import type { AgentUsageRecorded } from '../tauri/agentUsage';

const mockOnRecorded = vi.fn();
vi.mock('../tauri/agentUsage', () => ({
  onAgentUsageRecorded: (cb: (event: AgentUsageRecorded) => void) => mockOnRecorded(cb),
}));

import { useStore } from '../store';
import { useAgentUsageSync } from './useAgentUsageSync';

describe('useAgentUsageSync', () => {
  let load: Mock<(projectPath: string) => Promise<void>>;
  let append: Mock<(projectPath: string, row: ReturnType<typeof usageRow>) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    load = vi.fn(async () => undefined);
    append = vi.fn();
    useStore.setState({
      rootPath: '/project-a',
      projectDbInitialized: true,
      loadAgentUsage: load,
      appendAgentUsage: append,
    });
    mockOnRecorded.mockReturnValue(vi.fn());
  });

  it('loads the open project’s usage once its database is ready', () => {
    renderHook(() => useAgentUsageSync());
    expect(load).toHaveBeenCalledExactlyOnceWith('/project-a');
  });

  it('does not load before the project database is initialised or without a project', () => {
    useStore.setState({ projectDbInitialized: false });
    renderHook(() => useAgentUsageSync());
    expect(load).not.toHaveBeenCalled();

    useStore.setState({ projectDbInitialized: true, rootPath: null });
    renderHook(() => useAgentUsageSync());
    expect(load).not.toHaveBeenCalled();
  });

  it('files a recorded run under the project the event names', () => {
    renderHook(() => useAgentUsageSync());
    const listener = mockOnRecorded.mock.calls[0][0] as (event: AgentUsageRecorded) => void;
    const row = usageRow({ id: 'live' });

    listener({ projectPath: '/project-b', row });

    expect(append).toHaveBeenCalledExactlyOnceWith('/project-b', row);
  });

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn();
    mockOnRecorded.mockReturnValue(unsubscribe);

    renderHook(() => useAgentUsageSync()).unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});

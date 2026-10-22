import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { requestShowSupervisorRuns } from '@/lib/agents/showSupervisorRuns';
import { useShowSupervisorRuns } from './useShowSupervisorRuns';

describe('useShowSupervisorRuns', () => {
  it('selects the Supervisor Runs rail when a surface asks for it', () => {
    const setActiveActivity = vi.fn();
    renderHook(() => useShowSupervisorRuns(setActiveActivity));
    requestShowSupervisorRuns();
    expect(setActiveActivity).toHaveBeenCalledExactlyOnceWith('supervisor-runs');
  });

  it('stops listening once the shell is gone', () => {
    const setActiveActivity = vi.fn();
    const { unmount } = renderHook(() => useShowSupervisorRuns(setActiveActivity));
    unmount();
    requestShowSupervisorRuns();
    expect(setActiveActivity).not.toHaveBeenCalled();
  });
});

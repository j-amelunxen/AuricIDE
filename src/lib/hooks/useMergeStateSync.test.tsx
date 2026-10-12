import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStore } from '../store';
import type { GitMergeState } from '../tauri/gitMerge';
import { MERGE_POLL_MS, useMergeStateSync } from './useMergeStateSync';

const repo = (path: string) => ({ path, relativePath: '', name: path, kind: 'root' as const });

function state(inProgress: boolean): GitMergeState {
  return {
    inProgress,
    operation: inProgress ? 'merge' : 'none',
    oursLabel: 'main',
    theirsLabel: inProgress ? 'feature/x' : null,
    theirsOid: inProgress ? 'abc1234' : null,
    message: null,
    conflicts: [],
  };
}

describe('useMergeStateSync', () => {
  let refresh: Mock<(repoPath: string) => Promise<GitMergeState | null>>;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh = vi.fn(async () => null);
    useStore.setState({
      repos: [repo('/w'), repo('/w/api')],
      mergeStates: {},
      refreshMergeState: refresh,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads every known repo once on mount', () => {
    renderHook(() => useMergeStateSync());
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(['/w', '/w/api']);
  });

  it('reads again when the window gets focus or becomes visible', () => {
    renderHook(() => useMergeStateSync());
    refresh.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('does not poll while no merge is in progress', () => {
    renderHook(() => useMergeStateSync());
    refresh.mockClear();
    act(() => {
      vi.advanceTimersByTime(MERGE_POLL_MS * 3);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('polls every repo while a merge is in progress, and stops when it ends', () => {
    renderHook(() => useMergeStateSync());
    act(() => {
      useStore.setState({ mergeStates: { '/w': state(true) } });
    });
    refresh.mockClear();
    act(() => {
      vi.advanceTimersByTime(MERGE_POLL_MS);
    });
    expect(refresh.mock.calls.map((c) => c[0])).toEqual(['/w', '/w/api']);

    act(() => {
      useStore.setState({ mergeStates: { '/w': state(false) } });
    });
    refresh.mockClear();
    act(() => {
      vi.advanceTimersByTime(MERGE_POLL_MS * 3);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cleans up listeners and the timer on unmount', () => {
    useStore.setState({ mergeStates: { '/w': state(true) } });
    const { unmount } = renderHook(() => useMergeStateSync());
    unmount();
    refresh.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(MERGE_POLL_MS * 3);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockWatchDirectory = vi.fn();
const mockUnwatchDirectory = vi.fn();
const mockOnFsChange = vi.fn();

vi.mock('../tauri/watcher', () => ({
  watchDirectory: (...args: unknown[]) => mockWatchDirectory(...args),
  unwatchDirectory: (...args: unknown[]) => mockUnwatchDirectory(...args),
  onFsChange: (...args: unknown[]) => mockOnFsChange(...args),
}));

import { useFileWatcher } from './useFileWatcher';

describe('useFileWatcher', () => {
  const mockUnsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnFsChange.mockReturnValue(mockUnsubscribe);
  });

  it('calls watchDirectory with the provided path', () => {
    renderHook(() => useFileWatcher('/project', vi.fn()));
    expect(mockWatchDirectory).toHaveBeenCalledWith('/project');
  });

  it('sets up onFsChange listener', () => {
    const onChange = vi.fn();
    renderHook(() => useFileWatcher('/project', onChange));
    expect(mockOnFsChange).toHaveBeenCalledWith(onChange);
  });

  it('cleans up on unmount (unwatchDirectory + unsubscribe)', () => {
    const { unmount } = renderHook(() => useFileWatcher('/project', vi.fn()));
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockUnwatchDirectory).toHaveBeenCalledWith('/project');
  });

  it('does nothing when path is null', () => {
    renderHook(() => useFileWatcher(null, vi.fn()));
    expect(mockWatchDirectory).not.toHaveBeenCalled();
    expect(mockOnFsChange).not.toHaveBeenCalled();
  });

  it('re-watches when path changes', () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(({ path }) => useFileWatcher(path, onChange), {
      initialProps: { path: '/project-a' as string | null },
    });

    expect(mockWatchDirectory).toHaveBeenCalledWith('/project-a');

    rerender({ path: '/project-b' });

    // Should have cleaned up old and set up new
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockUnwatchDirectory).toHaveBeenCalledWith('/project-a');
    expect(mockWatchDirectory).toHaveBeenCalledWith('/project-b');
  });
});

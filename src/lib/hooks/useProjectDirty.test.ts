import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectDirty } from './useProjectDirty';
import { useStore } from '@/lib/store';

const mockLoadProjectsDirty = vi.fn();

vi.mock('@/lib/git/projectDirty', () => ({
  loadProjectsDirty: (...args: unknown[]) => mockLoadProjectsDirty(...args),
}));

describe('useProjectDirty', () => {
  beforeEach(() => {
    mockLoadProjectsDirty.mockReset();
    mockLoadProjectsDirty.mockResolvedValue({});
    useStore.setState({ projectDirtyEpoch: 0 });
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('does not probe when there are no project paths', () => {
    const { result } = renderHook(() => useProjectDirty([]));
    expect(result.current).toEqual({});
    expect(mockLoadProjectsDirty).not.toHaveBeenCalled();
  });

  it('exposes the dirty flags the probe returned', async () => {
    mockLoadProjectsDirty.mockResolvedValue({ '/a/website': true, '/a/apps': false });
    const { result } = renderHook(() => useProjectDirty(['/a/apps', '/a/website']));
    await waitFor(() => expect(result.current['/a/website']).toBe(true));
    expect(result.current['/a/apps']).toBe(false);
    expect(mockLoadProjectsDirty).toHaveBeenCalledWith(['/a/apps', '/a/website']);
  });

  it('asks again when the window becomes visible', async () => {
    mockLoadProjectsDirty
      .mockResolvedValueOnce({ '/a/website': true })
      .mockResolvedValueOnce({ '/a/website': false });
    const { result } = renderHook(() => useProjectDirty(['/a/website']));
    await waitFor(() => expect(result.current['/a/website']).toBe(true));

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current['/a/website']).toBe(false));
    expect(mockLoadProjectsDirty).toHaveBeenCalledTimes(2);
  });

  it('asks again when ignored nested repos change', async () => {
    mockLoadProjectsDirty
      .mockResolvedValueOnce({ '/a/website': true })
      .mockResolvedValueOnce({ '/a/website': false });
    const { result } = renderHook(() => useProjectDirty(['/a/website']));
    await waitFor(() => expect(result.current['/a/website']).toBe(true));

    await act(async () => {
      useStore.getState().bumpProjectDirtyEpoch();
    });

    await waitFor(() => expect(result.current['/a/website']).toBe(false));
    expect(mockLoadProjectsDirty).toHaveBeenCalledTimes(2);
  });
});

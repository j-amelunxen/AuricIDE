import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActiveTabContentLoader } from './useActiveTabContentLoader';

describe('useActiveTabContentLoader', () => {
  function setup(initialTabId: string | null) {
    const load = vi.fn(async () => {});
    const hook = renderHook(
      ({ tabId, loader }: { tabId: string | null; loader: typeof load }) =>
        useActiveTabContentLoader(tabId, loader),
      { initialProps: { tabId: initialTabId, loader: load } }
    );
    return { load, hook };
  }

  it('loads the content of the initially active tab', () => {
    const { load } = setup('/project/notes.md');
    expect(load).toHaveBeenCalledExactlyOnceWith('/project/notes.md');
  });

  it('loads the new tab content when the active tab changes (tab click)', () => {
    const { load, hook } = setup('/project/a.md');
    hook.rerender({ tabId: '/project/b.md', loader: load });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('/project/b.md');
  });

  it('loads the neighbour tab content after the active tab was closed', () => {
    const { load, hook } = setup('/project/a.md');
    hook.rerender({ tabId: '/project/neighbour.md', loader: load });
    expect(load).toHaveBeenLastCalledWith('/project/neighbour.md');
  });

  it('does nothing when no tab is active', () => {
    const { load } = setup(null);
    expect(load).not.toHaveBeenCalled();
  });

  it('skips diff tabs — their content is provided by the diff viewer', () => {
    const { load, hook } = setup('/project/a.md');
    hook.rerender({ tabId: 'diff:/project/a.md', loader: load });
    expect(load).toHaveBeenCalledExactlyOnceWith('/project/a.md');
  });

  it('swallows loader failures instead of raising unhandled rejections', async () => {
    const failingLoad = vi.fn(async () => {
      throw new Error('file gone');
    });
    renderHook(() => useActiveTabContentLoader('/project/deleted.md', failingLoad));
    // Flush microtasks — a rejection escaping here would fail the test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failingLoad).toHaveBeenCalled();
  });

  it('does not reload on unrelated re-renders (unstable loader identity)', () => {
    const { load, hook } = setup('/project/a.md');
    // Parent re-renders recreate the loader callback every time — the hook
    // must key on the tab id, not on callback identity.
    hook.rerender({ tabId: '/project/a.md', loader: vi.fn(async () => {}) });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

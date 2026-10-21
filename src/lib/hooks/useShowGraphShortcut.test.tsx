import { fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { graphTabId } from '@/lib/git/graphTabId';
import { useShowGraphShortcut } from './useShowGraphShortcut';

describe('useShowGraphShortcut', () => {
  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
      repos: [{ path: '/work/app', name: 'app', relativePath: '', kind: 'root' }],
      activeRepoPath: '/work/app',
      toasts: [],
      openGraph: vi.fn(async () => undefined),
    } as never);
  });

  it('opens the graph of the active repo on Option+Command+G', () => {
    renderHook(() => useShowGraphShortcut());
    // On macOS Option+G types a different character, so the physical key counts.
    fireEvent.keyDown(window, { code: 'KeyG', key: '©', metaKey: true, altKey: true });
    expect(useStore.getState().activeTabId).toBe(graphTabId('/work/app'));
  });

  it.each([
    ['Command+G alone', { metaKey: true }],
    ['Option+G alone', { altKey: true }],
    ['Shift+Option+Command+G', { metaKey: true, altKey: true, shiftKey: true }],
  ])('ignores %s', (_name, modifiers) => {
    renderHook(() => useShowGraphShortcut());
    fireEvent.keyDown(window, { code: 'KeyG', key: 'g', ...modifiers });
    expect(useStore.getState().openTabs).toEqual([]);
  });

  it('stops listening when unmounted', () => {
    const { unmount } = renderHook(() => useShowGraphShortcut());
    unmount();
    fireEvent.keyDown(window, { code: 'KeyG', key: 'g', metaKey: true, altKey: true });
    expect(useStore.getState().openTabs).toEqual([]);
  });
});

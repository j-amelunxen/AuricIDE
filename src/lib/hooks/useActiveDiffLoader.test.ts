import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DiffTabState } from '@/lib/git/diffTab';

const mockGetGitDiff = vi.hoisted(() => vi.fn());
const mockGetGitDiffFileRef = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauri/git', () => ({
  getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args),
  getGitDiffFileRef: (...args: unknown[]) => mockGetGitDiffFileRef(...args),
}));

const store = vi.hoisted(() => {
  const state = {
    activeTabId: null as string | null,
    rootPath: '/repo' as string | null,
    fileStatuses: [] as { path: string; status: string }[],
    diffByTabId: {} as Record<string, DiffTabState>,
    setDiffTab: vi.fn((tabId: string, next: DiffTabState) => {
      state.diffByTabId = { ...state.diffByTabId, [tabId]: next };
    }),
  };
  return state;
});

vi.mock('@/lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
    getState: () => store,
  }),
}));

import { useActiveDiffLoader } from './useActiveDiffLoader';

const unstagedA: DiffTabState = {
  patch: 'old-a',
  filePath: 'src/a.ts',
  source: { kind: 'unstaged' },
};

describe('useActiveDiffLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitDiff.mockResolvedValue('fresh-patch');
    mockGetGitDiffFileRef.mockResolvedValue('fresh-ref-patch');
    store.activeTabId = null;
    store.rootPath = '/repo';
    store.fileStatuses = [];
    store.diffByTabId = {};
  });

  it('does nothing without an active diff tab', async () => {
    store.activeTabId = '/repo/src/a.ts';
    renderHook(() => useActiveDiffLoader());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockGetGitDiff).not.toHaveBeenCalled();
  });

  it('refetches an unstaged patch when fileStatuses for that path change', async () => {
    const id = 'diff:unstaged:src/a.ts';
    store.activeTabId = id;
    store.diffByTabId = { [id]: unstagedA };
    store.fileStatuses = [{ path: 'src/a.ts', status: 'modified' }];

    const { rerender } = renderHook(() => useActiveDiffLoader());

    await vi.waitFor(() => {
      expect(mockGetGitDiff).toHaveBeenCalledWith('/repo', 'src/a.ts', 'unstaged');
    });
    mockGetGitDiff.mockClear();
    mockGetGitDiff.mockResolvedValue('after-commit');

    store.fileStatuses = [];
    rerender();

    await vi.waitFor(() => {
      expect(mockGetGitDiff).toHaveBeenCalledWith('/repo', 'src/a.ts', 'unstaged');
    });
    expect(store.setDiffTab).toHaveBeenCalledWith(id, {
      ...unstagedA,
      patch: 'after-commit',
    });
  });

  it('does not refetch a revision patch — those are immutable', async () => {
    const id = 'diff:rev:abcdef1:src/a.ts';
    store.activeTabId = id;
    store.diffByTabId = {
      [id]: {
        patch: 'at-rev',
        filePath: 'src/a.ts',
        source: { kind: 'revision', oid: 'abcdef1', summary: 'wip' },
      },
    };
    store.fileStatuses = [{ path: 'src/a.ts', status: 'modified' }];

    const { rerender } = renderHook(() => useActiveDiffLoader());
    store.fileStatuses = [];
    rerender();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockGetGitDiff).not.toHaveBeenCalled();
  });

  it('refetches a staged patch with side=staged', async () => {
    const id = 'diff:staged:src/a.ts';
    store.activeTabId = id;
    store.diffByTabId = {
      [id]: {
        patch: 'old-s',
        filePath: 'src/a.ts',
        source: { kind: 'staged' },
      },
    };
    store.fileStatuses = [{ path: 'src/a.ts', status: 'modified' }];

    renderHook(() => useActiveDiffLoader());

    await vi.waitFor(() => {
      expect(mockGetGitDiff).toHaveBeenCalledWith('/repo', 'src/a.ts', 'staged');
    });
    expect(store.setDiffTab).toHaveBeenCalledWith(id, {
      patch: 'fresh-patch',
      filePath: 'src/a.ts',
      source: { kind: 'staged' },
    });
  });

  it('refetches a compare-ref patch via getGitDiffFileRef, not working-tree getGitDiff', async () => {
    const id = 'diff:ref:origin%2Fmain:src/a.ts';
    store.activeTabId = id;
    store.diffByTabId = {
      [id]: {
        patch: 'vs-main',
        filePath: 'src/a.ts',
        source: { kind: 'ref', ref: 'origin/main' },
      },
    };
    store.fileStatuses = [{ path: 'src/a.ts', status: 'modified' }];

    renderHook(() => useActiveDiffLoader());

    await vi.waitFor(() => {
      expect(mockGetGitDiffFileRef).toHaveBeenCalledWith('/repo', 'origin/main', 'src/a.ts');
    });
    expect(mockGetGitDiff).not.toHaveBeenCalled();
    expect(store.setDiffTab).toHaveBeenCalledWith(id, {
      patch: 'fresh-ref-patch',
      filePath: 'src/a.ts',
      source: { kind: 'ref', ref: 'origin/main' },
    });
  });
});

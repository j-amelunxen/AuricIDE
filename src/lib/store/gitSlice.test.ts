import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GitFileStatus } from '../tauri/git';
import { createGitSlice, selectBlameHunks, type GitSlice } from './gitSlice';

const file = vi.hoisted(
  () =>
    (
      path: string,
      status: GitFileStatus['status'],
      staged: GitFileStatus['staged'] = null,
      unstaged: GitFileStatus['unstaged'] = null
    ): GitFileStatus => ({ path, status, staged, unstaged })
);

const sampleCommit = {
  oid: 'abc123def456',
  summary: 'fix the thing',
  author: 'Ada',
  timestamp: '2026-08-14 10:00:00',
  touched: ['src/a.ts'],
};

const sampleBlame = {
  oid: 'abc123def456',
  author: 'Ada',
  timestamp: '2026-08-14 10:00:00',
  summary: 'fix the thing',
  startLine: 1,
  lineCount: 3,
};

vi.mock('../tauri/git', () => ({
  getGitStatus: vi.fn(async () => [file('file.md', 'modified', null, 'modified')]),
  getBranchInfo: vi.fn(async () => ({ name: 'main', ahead: 0, behind: 0 })),
  stageFiles: vi.fn(async () => undefined),
  unstageFiles: vi.fn(async () => undefined),
  commitChanges: vi.fn(async () => 'abc123'),
  gitLogSince: vi.fn(async () => [sampleCommit]),
  listGitBranches: vi.fn(async () => [
    { name: 'main', kind: 'local', isCurrent: true },
    { name: 'origin/main', kind: 'remote', isCurrent: false },
  ]),
  getGitDiffRefFiles: vi.fn(async () => [{ path: 'src/a.ts', status: 'modified' }]),
  gitBlame: vi.fn(async () => [sampleBlame]),
}));

describe('gitSlice', () => {
  let store: StoreApi<GitSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<GitSlice>()(createGitSlice);
  });

  it('initializes with empty state', () => {
    const state = store.getState();
    expect(state.branchInfo).toBeNull();
    expect(state.fileStatuses).toEqual([]);
    expect(state.commitMessage).toBe('');
    expect(state.isCommitting).toBe(false);
    expect(state.diffByTabId).toEqual({});
  });

  it('refreshGitStatus fetches statuses and branch info', async () => {
    await store.getState().refreshGitStatus('/repo');
    const state = store.getState();
    expect(state.fileStatuses).toEqual([file('file.md', 'modified', null, 'modified')]);
    expect(state.branchInfo).toEqual({ name: 'main', ahead: 0, behind: 0 });
  });

  it('setCommitMessage updates message', () => {
    store.getState().setCommitMessage('test commit');
    expect(store.getState().commitMessage).toBe('test commit');
  });

  it('commit with nothing staged stages then commits', async () => {
    const { getGitStatus, stageFiles: mockStage, commitChanges } = await import('../tauri/git');
    vi.mocked(getGitStatus).mockResolvedValue([file('a.md', 'modified', null, 'modified')]);
    await store.getState().refreshGitStatus('/repo');
    vi.mocked(mockStage).mockClear();

    store.getState().setCommitMessage('test commit');
    const oid = await store.getState().commit('/repo');

    expect(mockStage).toHaveBeenCalledWith('/repo', ['a.md']);
    expect(commitChanges).toHaveBeenCalledWith('/repo', 'test commit');
    expect(oid).toBe('abc123');
    expect(store.getState().commitMessage).toBe('');
  });

  it('commit with something staged does not call stageFiles', async () => {
    const { getGitStatus, stageFiles: mockStage, commitChanges } = await import('../tauri/git');
    vi.mocked(getGitStatus).mockResolvedValue([file('a.md', 'modified', 'modified', null)]);
    await store.getState().refreshGitStatus('/repo');
    vi.mocked(mockStage).mockClear();

    store.getState().setCommitMessage('test commit');
    const oid = await store.getState().commit('/repo');

    expect(mockStage).not.toHaveBeenCalled();
    expect(commitChanges).toHaveBeenCalledWith('/repo', 'test commit');
    expect(oid).toBe('abc123');
  });

  it('commit returns null if message is empty', async () => {
    const { stageFiles: mockStage, commitChanges } = await import('../tauri/git');
    const oid = await store.getState().commit('/repo');
    expect(oid).toBeNull();
    expect(mockStage).not.toHaveBeenCalled();
    expect(commitChanges).not.toHaveBeenCalled();
  });

  it('stageFile calls stageFiles and refreshes', async () => {
    const { stageFiles: mockStage } = await import('../tauri/git');
    await store.getState().stageFile('/repo', 'file.md');
    expect(mockStage).toHaveBeenCalledWith('/repo', ['file.md']);
    expect(store.getState().fileStatuses.length).toBeGreaterThan(0);
  });

  it('unstageFile calls unstageFiles and refreshes', async () => {
    const { unstageFiles: mockUnstage } = await import('../tauri/git');
    await store.getState().unstageFile('/repo', 'file.md');
    expect(mockUnstage).toHaveBeenCalledWith('/repo', ['file.md']);
  });

  describe('stageAll', () => {
    it('stages every changed path in one call', async () => {
      const { getGitStatus, stageFiles: mockStage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([
        file('a.md', 'modified', null, 'modified'),
        file('b.md', 'untracked', null, 'untracked'),
        file('c.md', 'deleted', null, 'deleted'),
      ]);
      await store.getState().refreshGitStatus('/repo');

      await store.getState().stageAll('/repo');

      // One IPC round trip, not one per file. Deletions stay in.
      expect(mockStage).toHaveBeenCalledTimes(1);
      expect(mockStage).toHaveBeenCalledWith('/repo', ['a.md', 'b.md', 'c.md']);
    });

    it('leaves ignored and fully staged files alone', async () => {
      const { getGitStatus, stageFiles: mockStage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([
        file('a.md', 'modified', null, 'modified'),
        file('build/out.js', 'ignored'),
        file('done.md', 'added', 'added', null),
      ]);
      await store.getState().refreshGitStatus('/repo');

      await store.getState().stageAll('/repo');

      expect(mockStage).toHaveBeenCalledWith('/repo', ['a.md']);
    });

    it('does not call git when there is nothing to stage', async () => {
      const { getGitStatus, stageFiles: mockStage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([]);
      await store.getState().refreshGitStatus('/repo');
      vi.mocked(mockStage).mockClear();

      await store.getState().stageAll('/repo');

      expect(mockStage).not.toHaveBeenCalled();
    });
  });

  describe('unstageAll', () => {
    it('unstages every path that has a staged side', async () => {
      const { getGitStatus, unstageFiles: mockUnstage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([
        file('a.md', 'modified', 'modified', 'modified'),
        file('b.md', 'added', 'added', null),
        file('c.md', 'modified', null, 'modified'),
      ]);
      await store.getState().refreshGitStatus('/repo');

      await store.getState().unstageAll('/repo');

      expect(mockUnstage).toHaveBeenCalledTimes(1);
      expect(mockUnstage).toHaveBeenCalledWith('/repo', ['a.md', 'b.md']);
    });

    it('does not call git when nothing is staged', async () => {
      const { getGitStatus, unstageFiles: mockUnstage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([file('a.md', 'modified', null, 'modified')]);
      await store.getState().refreshGitStatus('/repo');
      vi.mocked(mockUnstage).mockClear();

      await store.getState().unstageAll('/repo');

      expect(mockUnstage).not.toHaveBeenCalled();
    });
  });

  describe('per-tab diff payloads', () => {
    const patchA = {
      patch: 'diff --git a/a.ts b/a.ts\n+one',
      filePath: 'src/a.ts',
      source: { kind: 'unstaged' as const },
    };
    const patchB = {
      patch: 'diff --git a/b.ts b/b.ts\n+two',
      filePath: 'src/b.ts',
      source: { kind: 'unstaged' as const },
    };

    it('setDiffTab stores a payload under the tab id', () => {
      store.getState().setDiffTab('diff:unstaged:src/a.ts', patchA);
      expect(store.getState().diffByTabId['diff:unstaged:src/a.ts']).toEqual(patchA);
    });

    it('two tab ids hold two independent patches', () => {
      store.getState().setDiffTab('diff:unstaged:src/a.ts', patchA);
      store.getState().setDiffTab('diff:unstaged:src/b.ts', patchB);

      const { diffByTabId } = store.getState();
      expect(diffByTabId['diff:unstaged:src/a.ts']?.patch).toBe(patchA.patch);
      expect(diffByTabId['diff:unstaged:src/b.ts']?.patch).toBe(patchB.patch);
    });

    it('clearDiffTab drops only that tab id', () => {
      store.getState().setDiffTab('diff:unstaged:src/a.ts', patchA);
      store.getState().setDiffTab('diff:unstaged:src/b.ts', patchB);

      store.getState().clearDiffTab('diff:unstaged:src/a.ts');

      expect(store.getState().diffByTabId['diff:unstaged:src/a.ts']).toBeUndefined();
      expect(store.getState().diffByTabId['diff:unstaged:src/b.ts']).toEqual(patchB);
    });

    it('resetGitInMemory drops every stored patch', () => {
      store.getState().setDiffTab('diff:unstaged:src/a.ts', patchA);
      store.getState().setDiffTab('diff:unstaged:src/b.ts', patchB);

      store.getState().resetGitInMemory();

      expect(store.getState().diffByTabId).toEqual({});
    });
  });

  describe('file history', () => {
    it('starts with an empty history view', () => {
      const state = store.getState();
      expect(state.scmView).toBe('changes');
      expect(state.historyPath).toBeNull();
      expect(state.historyCommits).toEqual([]);
      expect(state.historySelectedOid).toBeNull();
      expect(state.historyLoading).toBe(false);
    });

    it('loadFileHistory calls gitLogSince(repo, undefined, path) and stores commits', async () => {
      const { gitLogSince } = await import('../tauri/git');

      await store.getState().loadFileHistory('/repo', 'src/a.ts');

      expect(gitLogSince).toHaveBeenCalledWith('/repo', undefined, 'src/a.ts');
      expect(store.getState().historyPath).toBe('src/a.ts');
      expect(store.getState().historyCommits).toEqual([sampleCommit]);
      expect(store.getState().historyLoading).toBe(false);
    });

    it('setScmView switches the source-control pane', () => {
      store.getState().setScmView('history');
      expect(store.getState().scmView).toBe('history');
    });
  });

  describe('compare with branch', () => {
    it('starts with no compare target', () => {
      const state = store.getState();
      expect(state.branches).toEqual([]);
      expect(state.compareRef).toBeNull();
      expect(state.compareFiles).toEqual([]);
      expect(state.compareLoading).toBe(false);
    });

    it('loadCompare sets compareRef and files via getGitDiffRefFiles', async () => {
      const { getGitDiffRefFiles } = await import('../tauri/git');

      await store.getState().loadCompare('/repo', 'origin/main');

      expect(getGitDiffRefFiles).toHaveBeenCalledWith('/repo', 'origin/main');
      expect(store.getState().compareRef).toBe('origin/main');
      expect(store.getState().compareFiles).toEqual([{ path: 'src/a.ts', status: 'modified' }]);
      expect(store.getState().compareLoading).toBe(false);
    });

    it('loadBranches fills the branch list', async () => {
      const { listGitBranches } = await import('../tauri/git');

      await store.getState().loadBranches('/repo');

      expect(listGitBranches).toHaveBeenCalledWith('/repo');
      expect(store.getState().branches).toEqual([
        { name: 'main', kind: 'local', isCurrent: true },
        { name: 'origin/main', kind: 'remote', isCurrent: false },
      ]);
    });
  });

  describe('blame', () => {
    it('starts hidden with an empty cache', () => {
      expect(store.getState().blameVisible).toBe(false);
      expect(store.getState().blameByPath).toEqual({});
      expect(store.getState().blameLoading).toBe(false);
    });

    it('toggleBlame flips visibility', () => {
      store.getState().toggleBlame();
      expect(store.getState().blameVisible).toBe(true);
      store.getState().toggleBlame();
      expect(store.getState().blameVisible).toBe(false);
    });

    it('loadBlame stores hunks under the file path', async () => {
      const { gitBlame } = await import('../tauri/git');

      await store.getState().loadBlame('/repo', 'src/a.ts');

      expect(gitBlame).toHaveBeenCalledWith('/repo', 'src/a.ts');
      expect(store.getState().blameByPath['src/a.ts']).toEqual([sampleBlame]);
      expect(store.getState().blameLoading).toBe(false);
    });
  });

  describe('hunk navigation', () => {
    it('requestHunkNav bumps the nonce and records the direction', () => {
      expect(store.getState().hunkNavNonce).toBe(0);
      expect(store.getState().hunkNavDirection).toBeNull();

      store.getState().requestHunkNav('next');
      expect(store.getState().hunkNavNonce).toBe(1);
      expect(store.getState().hunkNavDirection).toBe('next');

      store.getState().requestHunkNav('prev');
      expect(store.getState().hunkNavNonce).toBe(2);
      expect(store.getState().hunkNavDirection).toBe('prev');
    });
  });

  it('resetGitInMemory clears history, compare, blame and hunk nav', async () => {
    store.getState().setScmView('history');
    await store.getState().loadFileHistory('/repo', 'src/a.ts');
    store.getState().setHistorySelectedOid('abc123def456');
    await store.getState().loadBranches('/repo');
    await store.getState().loadCompare('/repo', 'main');
    store.getState().toggleBlame();
    await store.getState().loadBlame('/repo', 'src/a.ts');
    store.getState().requestHunkNav('next');

    store.getState().resetGitInMemory();

    const state = store.getState();
    expect(state.scmView).toBe('changes');
    expect(state.historyPath).toBeNull();
    expect(state.historyCommits).toEqual([]);
    expect(state.historySelectedOid).toBeNull();
    expect(state.historyLoading).toBe(false);
    expect(state.branches).toEqual([]);
    expect(state.compareRef).toBeNull();
    expect(state.compareFiles).toEqual([]);
    expect(state.compareLoading).toBe(false);
    expect(state.blameVisible).toBe(false);
    expect(state.blameByPath).toEqual({});
    expect(state.blameLoading).toBe(false);
    expect(state.hunkNavNonce).toBe(0);
    expect(state.hunkNavDirection).toBeNull();
  });
});

describe('selectBlameHunks', () => {
  const hunk = {
    oid: 'abc',
    summary: 's',
    author: 'a',
    timestamp: 't',
    startLine: 1,
    lineCount: 2,
  };

  it('returns the hunks stored for the file', () => {
    const state = { rootPath: '/repo', blameByPath: { 'src/a.ts': [hunk] } };
    expect(selectBlameHunks(state, '/repo/src/a.ts')).toEqual([hunk]);
  });

  // The editor subscribes to this through `useStore`, and zustand v5 runs the
  // selector on every snapshot check without memoising it. A fresh `[]` per
  // call therefore reads as a changed store forever: React re-renders, gets
  // another new array, and gives up with "Maximum update depth exceeded" —
  // which is what opening any not-yet-blamed file used to do.
  it('hands back the same empty array every time a file has no blame', () => {
    const state = { rootPath: '/repo', blameByPath: {} };
    expect(selectBlameHunks(state, '/repo/src/a.ts')).toBe(
      selectBlameHunks(state, '/repo/src/a.ts')
    );
  });

  it('hands back the same empty array when there is no project open', () => {
    const state = { rootPath: null, blameByPath: {} };
    expect(selectBlameHunks(state, '/repo/src/a.ts')).toBe(selectBlameHunks(state, undefined));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GitFileStatus, GitRepoRef } from '../tauri/git';
import {
  createGitSlice,
  selectBlameHunks,
  selectBranchNameForPath,
  selectChangedFileCount,
  selectRepoForPath,
  selectRepoState,
  type GitSlice,
} from './gitSlice';

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

function repoRef(
  path: string,
  relativePath: string,
  kind: GitRepoRef['kind'] = 'root'
): GitRepoRef {
  return { path, relativePath, name: relativePath || path.split('/').pop() || path, kind };
}

const repoRoot = repoRef('/w', '', 'root');
const repoApi = repoRef('/w/api', 'api', 'nested');
const repoWeb = repoRef('/w/web', 'web', 'nested');

vi.mock('../tauri/git', () => ({
  discoverGitRepos: vi.fn(async () => [repoRoot]),
  getGitStatus: vi.fn(async () => [file('file.md', 'modified', null, 'modified')]),
  getBranchInfo: vi.fn(async () => ({ name: 'main', ahead: 0, behind: 0 })),
  stageFiles: vi.fn(async () => undefined),
  unstageFiles: vi.fn(async () => undefined),
  commitChanges: vi.fn(async () => 'abc123'),
  pushChanges: vi.fn(async () => undefined),
  gitLogSince: vi.fn(async () => [sampleCommit]),
  listGitBranches: vi.fn(async () => [
    { name: 'main', kind: 'local', isCurrent: true },
    { name: 'origin/main', kind: 'remote', isCurrent: false },
  ]),
  getGitDiffRefFiles: vi.fn(async () => [{ path: 'src/a.ts', status: 'modified' }]),
  gitBlame: vi.fn(async () => [sampleBlame]),
  listGitWorktrees: vi.fn(async () => []),
  removeGitWorktree: vi.fn(async () => undefined),
}));

describe('gitSlice', () => {
  let store: StoreApi<GitSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<GitSlice>()(createGitSlice);
  });

  it('initializes with empty state', () => {
    const state = store.getState();
    expect(state.repos).toEqual([]);
    expect(state.repoStates).toEqual({});
    expect(state.activeRepoPath).toBeNull();
    expect(state.diffByTabId).toEqual({});
    expect(state.agentWorktrees).toEqual([]);
  });

  describe('discoverAndRefreshGit', () => {
    it('discovers repos and refreshes status + branch for each', async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);

      await store.getState().discoverAndRefreshGit('/w');

      const state = store.getState();
      expect(state.repos).toEqual([repoRoot, repoApi]);
      expect(state.repoStates[repoRoot.path]?.fileStatuses).toEqual([
        file('file.md', 'modified', null, 'modified'),
      ]);
      expect(state.repoStates[repoRoot.path]?.branchInfo).toEqual({
        name: 'main',
        ahead: 0,
        behind: 0,
      });
      expect(state.repoStates[repoApi.path]?.ref).toEqual(repoApi);
    });

    it('loads Auric worktrees for every discovered repo', async () => {
      const { discoverGitRepos, listGitWorktrees } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
      vi.mocked(listGitWorktrees).mockImplementation(async (repoPath: string) =>
        repoPath === repoRoot.path
          ? [
              {
                path: '/w.auric-wt/fix-ab12',
                name: 'fix-ab12',
                branch: 'auric/fix-ab12',
                sourceRepo: repoRoot.path,
                isAuric: true,
                dirty: false,
                branchAhead: false,
              },
            ]
          : []
      );

      await store.getState().discoverAndRefreshGit('/w');

      expect(listGitWorktrees).toHaveBeenCalledWith(repoRoot.path);
      expect(listGitWorktrees).toHaveBeenCalledWith(repoApi.path);
      expect(store.getState().agentWorktrees).toEqual([
        expect.objectContaining({ path: '/w.auric-wt/fix-ab12' }),
      ]);
    });

    it('sets repos to an empty answer when discovery fails, not an error', async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockRejectedValue(new Error('not a directory'));

      await store.getState().discoverAndRefreshGit('/nope');

      expect(store.getState().repos).toEqual([]);
      expect(store.getState().repoStates).toEqual({});
    });

    it("keeps a repo's status empty rather than dropping the other repos when one fails", async () => {
      const { discoverGitRepos, getGitStatus } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
      vi.mocked(getGitStatus).mockImplementation(async (repoPath: string) => {
        if (repoPath === repoApi.path) throw new Error('git status failed');
        return [file('file.md', 'modified', null, 'modified')];
      });

      await store.getState().discoverAndRefreshGit('/w');

      const state = store.getState();
      expect(state.repos).toEqual([repoRoot, repoApi]);
      expect(state.repoStates[repoRoot.path]?.fileStatuses).toEqual([
        file('file.md', 'modified', null, 'modified'),
      ]);
      expect(state.repoStates[repoApi.path]?.fileStatuses).toEqual([]);
      expect(state.repoStates[repoApi.path]?.branchInfo).toBeNull();
    });

    it('prunes repoStates entries for repos no longer discovered, keeping the survivors', async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot, repoApi]);
      await store.getState().discoverAndRefreshGit('/w');
      store.getState().setCommitMessage(repoRoot.path, 'keep me');
      expect(Object.keys(store.getState().repoStates).sort()).toEqual(
        [repoRoot.path, repoApi.path].sort()
      );

      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');

      const state = store.getState();
      expect(Object.keys(state.repoStates)).toEqual([repoRoot.path]);
      expect(state.repoStates[repoApi.path]).toBeUndefined();
      // Pruning must not wipe the surviving repo's own UI state.
      expect(state.repoStates[repoRoot.path]?.commitMessage).toBe('keep me');
      expect(selectChangedFileCount(state)).toBe(
        state.repoStates[repoRoot.path]?.fileStatuses.filter((f) => f.status !== 'ignored').length
      );
    });

    it('does not resurrect a repo pruned by a later, faster concurrent discovery', async () => {
      const { discoverGitRepos, getGitStatus, getBranchInfo } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot, repoApi]);
      vi.mocked(getBranchInfo).mockResolvedValue({ name: 'main', ahead: 0, behind: 0 });

      let resolveApiStatus: (value: GitFileStatus[]) => void = () => {};
      const apiStatusPromise = new Promise<GitFileStatus[]>((resolve) => {
        resolveApiStatus = resolve;
      });
      vi.mocked(getGitStatus).mockImplementation(async (repoPath: string) =>
        repoPath === repoApi.path
          ? apiStatusPromise
          : [file('file.md', 'modified', null, 'modified')]
      );

      // Call A: discovers both repos, but repoApi's status fetch is stuck pending.
      const callA = store.getState().discoverAndRefreshGit('/w');
      try {
        // Wait for the condition that actually matters — call A's initial
        // set() has landed — rather than counting microtasks, which is
        // brittle under load (a slow tick can land before or after the
        // fixed number of `await Promise.resolve()` hops resolves).
        await vi.waitFor(() => expect(store.getState().repos).toEqual([repoRoot, repoApi]));

        // Call B: a later, narrower rediscovery completes fully before A's stuck fetch does.
        vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot]);
        await store.getState().discoverAndRefreshGit('/w');
        expect(store.getState().repos).toEqual([repoRoot]);
        expect(store.getState().repoStates[repoApi.path]).toBeUndefined();

        // A's stale repoApi fetch finally resolves — it must not resurrect the pruned repo.
        resolveApiStatus([file('stale.md', 'modified', null, 'modified')]);
        await callA;

        expect(store.getState().repos).toEqual([repoRoot]);
        expect(store.getState().repoStates[repoApi.path]).toBeUndefined();
      } finally {
        // If an assertion above throws before the promise is resolved, it
        // must not stay pending — that leaks into the mock's implementation
        // and hangs every later test that discovers repoApi. Resolving an
        // already-settled promise is a no-op, so this is safe either way.
        resolveApiStatus([]);
        await callA.catch(() => {});
      }
    });

    it('seeds a repoStates entry for every discovered repo immediately, before status IPC resolves', async () => {
      const { discoverGitRepos, getGitStatus, getBranchInfo } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot, repoApi]);

      let resolveApiStatus: (value: GitFileStatus[]) => void = () => {};
      const apiStatusPromise = new Promise<GitFileStatus[]>((resolve) => {
        resolveApiStatus = resolve;
      });
      vi.mocked(getGitStatus).mockImplementation(async (repoPath: string) =>
        repoPath === repoApi.path
          ? apiStatusPromise
          : [file('file.md', 'modified', null, 'modified')]
      );
      vi.mocked(getBranchInfo).mockResolvedValue({ name: 'main', ahead: 0, behind: 0 });

      const discovery = store.getState().discoverAndRefreshGit('/w');
      try {
        await vi.waitFor(() => expect(store.getState().repos).toEqual([repoRoot, repoApi]));

        // repoApi's status IPC is still pending — the commit-box textarea must
        // already be writable, or a keystroke here is silently swallowed.
        store.getState().setCommitMessage(repoApi.path, 'x');
        expect(store.getState().repoStates[repoApi.path]?.commitMessage).toBe('x');

        resolveApiStatus([file('a.md', 'modified', null, 'modified')]);
        await discovery;

        // The later status write must not clobber the message typed while it was in flight.
        expect(store.getState().repoStates[repoApi.path]?.commitMessage).toBe('x');
      } finally {
        // Same reasoning as the concurrent-discovery test above: never leave
        // this promise pending for a later test's mock to inherit.
        resolveApiStatus([]);
        await discovery.catch(() => {});
      }
    });

    it('prunes blame entries for files no longer under any discovered repo', async () => {
      // repoApi and repoWeb are siblings under repoRoot — neither path prefixes
      // the other, so pruning repoWeb can't be confused with repoApi surviving.
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot, repoApi, repoWeb]);
      await store.getState().discoverAndRefreshGit('/w');
      await store.getState().loadBlame(repoApi.path, 'src/main.rs');
      await store.getState().loadBlame(repoWeb.path, 'index.ts');

      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot, repoApi]);
      await store.getState().discoverAndRefreshGit('/w');

      const state = store.getState();
      expect(state.blameByPath[`${repoApi.path}/src/main.rs`]).toEqual([sampleBlame]);
      expect(state.blameByPath[`${repoWeb.path}/index.ts`]).toBeUndefined();
    });

    it('never calls getGitStatus/getBranchInfo when discovery finds no repos', async () => {
      const { discoverGitRepos, getGitStatus, getBranchInfo } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([]);

      await store.getState().discoverAndRefreshGit('/nope');

      expect(getGitStatus).not.toHaveBeenCalled();
      expect(getBranchInfo).not.toHaveBeenCalled();
    });

    describe('activeRepoPath', () => {
      it('defaults to the first repo on first discovery', async () => {
        const { discoverGitRepos } = await import('../tauri/git');
        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);

        await store.getState().discoverAndRefreshGit('/w');

        expect(store.getState().activeRepoPath).toBe(repoRoot.path);
      });

      it('keeps the current active repo if it still exists after rediscovery', async () => {
        const { discoverGitRepos } = await import('../tauri/git');
        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
        await store.getState().discoverAndRefreshGit('/w');
        store.getState().setActiveRepoPath(repoApi.path);

        await store.getState().discoverAndRefreshGit('/w');

        expect(store.getState().activeRepoPath).toBe(repoApi.path);
      });

      it('falls back to the first repo when the active one is gone', async () => {
        const { discoverGitRepos } = await import('../tauri/git');
        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
        await store.getState().discoverAndRefreshGit('/w');
        store.getState().setActiveRepoPath(repoApi.path);

        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
        await store.getState().discoverAndRefreshGit('/w');

        expect(store.getState().activeRepoPath).toBe(repoRoot.path);
      });

      it('falls back to null when no repo is found', async () => {
        const { discoverGitRepos } = await import('../tauri/git');
        vi.mocked(discoverGitRepos).mockResolvedValue([]);

        await store.getState().discoverAndRefreshGit('/nope');

        expect(store.getState().activeRepoPath).toBeNull();
      });

      it('keeps compareRef and history when the active repo survives rediscovery', async () => {
        const { discoverGitRepos } = await import('../tauri/git');
        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
        await store.getState().discoverAndRefreshGit('/w');
        store.getState().setActiveRepoPath(repoApi.path);
        await store.getState().loadCompare(repoApi.path, 'origin/main');

        await store.getState().discoverAndRefreshGit('/w');

        expect(store.getState().activeRepoPath).toBe(repoApi.path);
        expect(store.getState().compareRef).toBe('origin/main');
      });

      it('clears compareRef and history when the active repo vanishes on rediscovery', async () => {
        const { discoverGitRepos } = await import('../tauri/git');
        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
        await store.getState().discoverAndRefreshGit('/w');
        store.getState().setActiveRepoPath(repoApi.path);
        await store.getState().loadCompare(repoApi.path, 'origin/main');

        vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
        await store.getState().discoverAndRefreshGit('/w');

        expect(store.getState().activeRepoPath).toBe(repoRoot.path);
        expect(store.getState().compareRef).toBeNull();
      });
    });
  });

  describe('setActiveRepoPath', () => {
    it('switches the active repo directly', () => {
      store.getState().setActiveRepoPath('/w/api');
      expect(store.getState().activeRepoPath).toBe('/w/api');
    });

    it('clears the review state (history, branches, compare) when the active repo changes', async () => {
      store.getState().setActiveRepoPath('/w');
      await store.getState().loadFileHistory('/w', 'src/a.ts');
      store.getState().setHistorySelectedOid('abc123def456');
      await store.getState().loadBranches('/w');
      await store.getState().loadCompare('/w', 'main');

      store.getState().setActiveRepoPath('/w/api');

      const state = store.getState();
      expect(state.activeRepoPath).toBe('/w/api');
      expect(state.historyPath).toBeNull();
      expect(state.historyCommits).toEqual([]);
      expect(state.historySelectedOid).toBeNull();
      expect(state.historyLoading).toBe(false);
      expect(state.branches).toEqual([]);
      expect(state.compareRef).toBeNull();
      expect(state.compareFiles).toEqual([]);
      expect(state.compareLoading).toBe(false);
    });

    it('does not touch blame or diff tabs when the active repo changes', async () => {
      const patch = {
        patch: 'diff --git a/a.ts b/a.ts\n+one',
        filePath: 'src/a.ts',
        source: { kind: 'unstaged' as const },
        repoPath: '/w',
      };
      store.getState().setDiffTab('diff:unstaged:/w:src/a.ts', patch);
      await store.getState().loadBlame('/w', 'src/a.ts');
      store.getState().toggleBlame();

      store.getState().setActiveRepoPath('/w/api');

      const state = store.getState();
      expect(state.diffByTabId['diff:unstaged:/w:src/a.ts']).toEqual(patch);
      expect(state.blameByPath['/w/src/a.ts']).toEqual([sampleBlame]);
      expect(state.blameVisible).toBe(true);
    });

    it('is a no-op — same state object — when called with the value it already holds', () => {
      store.getState().setActiveRepoPath('/w/api');
      const before = store.getState();

      store.getState().setActiveRepoPath('/w/api');

      expect(store.getState()).toBe(before);
    });
  });

  describe('refreshGitStatus', () => {
    it('refreshes status + branch for every known repo without rediscovering', async () => {
      const { discoverGitRepos, getGitStatus } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
      await store.getState().discoverAndRefreshGit('/w');
      vi.mocked(discoverGitRepos).mockClear();
      vi.mocked(getGitStatus).mockResolvedValue([file('changed.md', 'modified', null, 'modified')]);

      await store.getState().refreshGitStatus();

      expect(discoverGitRepos).not.toHaveBeenCalled();
      expect(store.getState().repoStates[repoRoot.path]?.fileStatuses).toEqual([
        file('changed.md', 'modified', null, 'modified'),
      ]);
    });

    it('a typed commit message survives the watcher-triggered refresh', async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
      store.getState().setCommitMessage(repoRoot.path, 'wip');

      await store.getState().refreshGitStatus();

      expect(store.getState().repoStates[repoRoot.path]?.commitMessage).toBe('wip');
    });
  });

  describe('refreshRepoStatus', () => {
    it('a typed commit message survives a single-repo refresh', async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValueOnce([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
      store.getState().setCommitMessage(repoRoot.path, 'wip');

      await store.getState().refreshRepoStatus(repoRoot.path);

      expect(store.getState().repoStates[repoRoot.path]?.commitMessage).toBe('wip');
    });
  });

  describe('per-repo commit messages', () => {
    it('two repos keep independent commit messages', async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
      await store.getState().discoverAndRefreshGit('/w');

      store.getState().setCommitMessage(repoRoot.path, 'root message');
      store.getState().setCommitMessage(repoApi.path, 'api message');

      expect(store.getState().repoStates[repoRoot.path]?.commitMessage).toBe('root message');
      expect(store.getState().repoStates[repoApi.path]?.commitMessage).toBe('api message');
    });
  });

  describe('commit', () => {
    beforeEach(async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
    });

    it('commit with nothing staged stages then commits', async () => {
      const { getGitStatus, stageFiles: mockStage, commitChanges } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([file('a.md', 'modified', null, 'modified')]);
      await store.getState().refreshRepoStatus(repoRoot.path);
      vi.mocked(mockStage).mockClear();

      store.getState().setCommitMessage(repoRoot.path, 'test commit');
      const oid = await store.getState().commit(repoRoot.path);

      expect(mockStage).toHaveBeenCalledWith(repoRoot.path, ['a.md']);
      expect(commitChanges).toHaveBeenCalledWith(repoRoot.path, 'test commit');
      expect(oid).toBe('abc123');
      expect(store.getState().repoStates[repoRoot.path]?.commitMessage).toBe('');
    });

    it('commit with something staged does not call stageFiles', async () => {
      const { getGitStatus, stageFiles: mockStage, commitChanges } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([file('a.md', 'modified', 'modified', null)]);
      await store.getState().refreshRepoStatus(repoRoot.path);
      vi.mocked(mockStage).mockClear();

      store.getState().setCommitMessage(repoRoot.path, 'test commit');
      const oid = await store.getState().commit(repoRoot.path);

      expect(mockStage).not.toHaveBeenCalled();
      expect(commitChanges).toHaveBeenCalledWith(repoRoot.path, 'test commit');
      expect(oid).toBe('abc123');
    });

    it('commit returns null if message is empty', async () => {
      const { stageFiles: mockStage, commitChanges } = await import('../tauri/git');
      const oid = await store.getState().commit(repoRoot.path);
      expect(oid).toBeNull();
      expect(mockStage).not.toHaveBeenCalled();
      expect(commitChanges).not.toHaveBeenCalled();
    });

    it("commit only clears and refreshes that repo's state", async () => {
      const { discoverGitRepos, getGitStatus } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot, repoApi]);
      await store.getState().discoverAndRefreshGit('/w');
      store.getState().setCommitMessage(repoRoot.path, 'root message');
      store.getState().setCommitMessage(repoApi.path, 'api message');
      vi.mocked(getGitStatus).mockClear();

      await store.getState().commit(repoRoot.path);

      expect(getGitStatus).toHaveBeenCalledTimes(1);
      expect(getGitStatus).toHaveBeenCalledWith(repoRoot.path);
      expect(store.getState().repoStates[repoRoot.path]?.commitMessage).toBe('');
      expect(store.getState().repoStates[repoApi.path]?.commitMessage).toBe('api message');
    });
  });

  describe('stageFile / unstageFile', () => {
    beforeEach(async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
    });

    it('stageFile calls stageFiles and refreshes that repo', async () => {
      const { stageFiles: mockStage } = await import('../tauri/git');
      await store.getState().stageFile(repoRoot.path, 'file.md');
      expect(mockStage).toHaveBeenCalledWith(repoRoot.path, ['file.md']);
      expect(store.getState().repoStates[repoRoot.path]?.fileStatuses.length).toBeGreaterThan(0);
    });

    it('unstageFile calls unstageFiles and refreshes that repo', async () => {
      const { unstageFiles: mockUnstage } = await import('../tauri/git');
      await store.getState().unstageFile(repoRoot.path, 'file.md');
      expect(mockUnstage).toHaveBeenCalledWith(repoRoot.path, ['file.md']);
    });
  });

  describe('stageAll', () => {
    beforeEach(async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
    });

    it('stages every changed path in that repo in one call', async () => {
      const { getGitStatus, stageFiles: mockStage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([
        file('a.md', 'modified', null, 'modified'),
        file('b.md', 'untracked', null, 'untracked'),
        file('c.md', 'deleted', null, 'deleted'),
      ]);
      await store.getState().refreshRepoStatus(repoRoot.path);

      await store.getState().stageAll(repoRoot.path);

      expect(mockStage).toHaveBeenCalledTimes(1);
      expect(mockStage).toHaveBeenCalledWith(repoRoot.path, ['a.md', 'b.md', 'c.md']);
    });

    it('leaves ignored and fully staged files alone', async () => {
      const { getGitStatus, stageFiles: mockStage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([
        file('a.md', 'modified', null, 'modified'),
        file('build/out.js', 'ignored'),
        file('done.md', 'added', 'added', null),
      ]);
      await store.getState().refreshRepoStatus(repoRoot.path);

      await store.getState().stageAll(repoRoot.path);

      expect(mockStage).toHaveBeenCalledWith(repoRoot.path, ['a.md']);
    });

    it('does not call git when there is nothing to stage', async () => {
      const { getGitStatus, stageFiles: mockStage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([]);
      await store.getState().refreshRepoStatus(repoRoot.path);
      vi.mocked(mockStage).mockClear();

      await store.getState().stageAll(repoRoot.path);

      expect(mockStage).not.toHaveBeenCalled();
    });
  });

  describe('unstageAll', () => {
    beforeEach(async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
    });

    it('unstages every path that has a staged side', async () => {
      const { getGitStatus, unstageFiles: mockUnstage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([
        file('a.md', 'modified', 'modified', 'modified'),
        file('b.md', 'added', 'added', null),
        file('c.md', 'modified', null, 'modified'),
      ]);
      await store.getState().refreshRepoStatus(repoRoot.path);

      await store.getState().unstageAll(repoRoot.path);

      expect(mockUnstage).toHaveBeenCalledTimes(1);
      expect(mockUnstage).toHaveBeenCalledWith(repoRoot.path, ['a.md', 'b.md']);
    });

    it('does not call git when nothing is staged', async () => {
      const { getGitStatus, unstageFiles: mockUnstage } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockResolvedValue([file('a.md', 'modified', null, 'modified')]);
      await store.getState().refreshRepoStatus(repoRoot.path);
      vi.mocked(mockUnstage).mockClear();

      await store.getState().unstageAll(repoRoot.path);

      expect(mockUnstage).not.toHaveBeenCalled();
    });
  });

  describe('push', () => {
    beforeEach(async () => {
      const { discoverGitRepos } = await import('../tauri/git');
      vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
      await store.getState().discoverAndRefreshGit('/w');
    });

    it('pushes and refreshes that repo', async () => {
      const { pushChanges, getGitStatus } = await import('../tauri/git');
      vi.mocked(getGitStatus).mockClear();

      await store.getState().push(repoRoot.path);

      expect(pushChanges).toHaveBeenCalledWith(repoRoot.path);
      expect(getGitStatus).toHaveBeenCalledWith(repoRoot.path);
    });

    it('resets isPushing even when the push rejects, and rethrows', async () => {
      const { pushChanges } = await import('../tauri/git');
      vi.mocked(pushChanges).mockRejectedValueOnce(new Error('no remote'));

      await expect(store.getState().push(repoRoot.path)).rejects.toThrow('no remote');
      expect(store.getState().repoStates[repoRoot.path]?.isPushing).toBe(false);
    });
  });

  describe('per-tab diff payloads', () => {
    const patchA = {
      patch: 'diff --git a/a.ts b/a.ts\n+one',
      filePath: 'src/a.ts',
      source: { kind: 'unstaged' as const },
      repoPath: '/w',
    };
    const patchB = {
      patch: 'diff --git a/b.ts b/b.ts\n+two',
      filePath: 'src/b.ts',
      source: { kind: 'unstaged' as const },
      repoPath: '/w/api',
    };

    it('setDiffTab stores a payload under the tab id', () => {
      store.getState().setDiffTab('diff:unstaged:/w:src/a.ts', patchA);
      expect(store.getState().diffByTabId['diff:unstaged:/w:src/a.ts']).toEqual(patchA);
    });

    it('two tab ids hold two independent patches', () => {
      store.getState().setDiffTab('diff:unstaged:/w:src/a.ts', patchA);
      store.getState().setDiffTab('diff:unstaged:/w/api:src/b.ts', patchB);

      const { diffByTabId } = store.getState();
      expect(diffByTabId['diff:unstaged:/w:src/a.ts']?.patch).toBe(patchA.patch);
      expect(diffByTabId['diff:unstaged:/w/api:src/b.ts']?.patch).toBe(patchB.patch);
    });

    it('clearDiffTab drops only that tab id', () => {
      store.getState().setDiffTab('diff:unstaged:/w:src/a.ts', patchA);
      store.getState().setDiffTab('diff:unstaged:/w/api:src/b.ts', patchB);

      store.getState().clearDiffTab('diff:unstaged:/w:src/a.ts');

      expect(store.getState().diffByTabId['diff:unstaged:/w:src/a.ts']).toBeUndefined();
      expect(store.getState().diffByTabId['diff:unstaged:/w/api:src/b.ts']).toEqual(patchB);
    });

    it('resetGitInMemory drops every stored patch', () => {
      store.getState().setDiffTab('diff:unstaged:/w:src/a.ts', patchA);
      store.getState().setDiffTab('diff:unstaged:/w/api:src/b.ts', patchB);

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

    it('loadBlame stores hunks under the absolute path (repoPath + relative path)', async () => {
      const { gitBlame } = await import('../tauri/git');

      await store.getState().loadBlame('/repo', 'src/a.ts');

      expect(gitBlame).toHaveBeenCalledWith('/repo', 'src/a.ts');
      expect(store.getState().blameByPath['/repo/src/a.ts']).toEqual([sampleBlame]);
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

  it('resetGitInMemory clears repos, repoStates, activeRepoPath, history, compare, blame and hunk nav', async () => {
    const { discoverGitRepos } = await import('../tauri/git');
    vi.mocked(discoverGitRepos).mockResolvedValue([repoRoot]);
    await store.getState().discoverAndRefreshGit('/w');
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
    expect(state.repos).toEqual([]);
    expect(state.repoStates).toEqual({});
    expect(state.activeRepoPath).toBeNull();
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
    expect(state.agentWorktrees).toEqual([]);
  });

  describe('agent worktrees', () => {
    const tree = {
      path: '/w.auric-wt/fix-ab12',
      name: 'fix-ab12',
      branch: 'auric/fix-ab12',
      sourceRepo: '/w',
      isAuric: true,
      dirty: false,
      branchAhead: false,
    };

    it('removeAgentWorktree deletes then reloads', async () => {
      const { removeGitWorktree, listGitWorktrees } = await import('../tauri/git');
      store.setState({ agentWorktrees: [tree], repos: [repoRoot] });
      vi.mocked(listGitWorktrees).mockResolvedValueOnce([]);

      await store.getState().removeAgentWorktree(tree.path, false);

      expect(removeGitWorktree).toHaveBeenCalledWith('/w', tree.path, false);
      expect(store.getState().agentWorktrees).toEqual([]);
    });

    it('removeAgentWorktree refuses an unknown path', async () => {
      await expect(store.getState().removeAgentWorktree('/nope', true)).rejects.toThrow(
        'worktree not found'
      );
    });
  });
});

describe('selectRepoState', () => {
  it('returns the state stored for that repo path', () => {
    const state = {
      repoStates: {
        '/w': {
          ref: repoRoot,
          branchInfo: null,
          fileStatuses: [],
          commitMessage: '',
          isCommitting: false,
          isPushing: false,
        },
      },
    };
    expect(selectRepoState(state, '/w')?.ref).toEqual(repoRoot);
  });

  it('returns undefined for an unknown repo path', () => {
    const state = { repoStates: {} };
    expect(selectRepoState(state, '/w')).toBeUndefined();
  });
});

describe('selectRepoForPath', () => {
  it('delegates to repoForPath', () => {
    const state = { repos: [repoRoot, repoApi] };
    expect(selectRepoForPath(state, '/w/api/src/main.rs')).toEqual(repoApi);
  });

  it('returns null when nothing matches', () => {
    const state = { repos: [repoRoot, repoApi] };
    expect(selectRepoForPath(state, '/elsewhere/file.ts')).toBeNull();
  });
});

describe('selectChangedFileCount', () => {
  it('sums non-ignored statuses across every repo', () => {
    const state = {
      repoStates: {
        '/w': {
          ref: repoRoot,
          branchInfo: null,
          fileStatuses: [file('a.md', 'modified', null, 'modified'), file('build/', 'ignored')],
          commitMessage: '',
          isCommitting: false,
          isPushing: false,
        },
        '/w/api': {
          ref: repoApi,
          branchInfo: null,
          fileStatuses: [file('b.md', 'untracked', null, 'untracked')],
          commitMessage: '',
          isCommitting: false,
          isPushing: false,
        },
      },
    };
    expect(selectChangedFileCount(state)).toBe(2);
  });

  it('is zero when there are no repos', () => {
    expect(selectChangedFileCount({ repoStates: {} })).toBe(0);
  });
});

describe('selectBranchNameForPath', () => {
  const repoState = (ref: GitRepoRef, branchName: string) => ({
    ref,
    branchInfo: { name: branchName, ahead: 0, behind: 0 },
    fileStatuses: [],
    commitMessage: '',
    isCommitting: false,
    isPushing: false,
  });

  it("uses the path's own repo when one is found", () => {
    const state = {
      repos: [repoRoot, repoApi],
      repoStates: {
        '/w': repoState(repoRoot, 'main'),
        '/w/api': repoState(repoApi, 'feature/api'),
      },
    };
    expect(selectBranchNameForPath(state, '/w/api/src/main.rs')).toBe('feature/api');
  });

  it('falls back to the root repo when the path matches no repo', () => {
    const state = {
      repos: [repoRoot, repoApi],
      repoStates: { '/w': repoState(repoRoot, 'main') },
    };
    expect(selectBranchNameForPath(state, '/elsewhere/file.ts')).toBe('main');
  });

  it('falls back to the first repo when there is no root repo and no path', () => {
    const web = repoRef('/w/web', 'web', 'nested');
    const state = {
      repos: [repoApi, web],
      repoStates: { '/w/api': repoState(repoApi, 'feature/api') },
    };
    expect(selectBranchNameForPath(state, null)).toBe('feature/api');
  });

  it('returns null when there are no repos at all', () => {
    const state = { repos: [], repoStates: {} };
    expect(selectBranchNameForPath(state, null)).toBeNull();
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

  it('returns the hunks stored for the absolute file path', () => {
    const state = { blameByPath: { '/repo/src/a.ts': [hunk] } };
    expect(selectBlameHunks(state, '/repo/src/a.ts')).toEqual([hunk]);
  });

  // The editor subscribes to this through `useStore`, and zustand v5 runs the
  // selector on every snapshot check without memoising it. A fresh `[]` per
  // call therefore reads as a changed store forever: React re-renders, gets
  // another new array, and gives up with "Maximum update depth exceeded" —
  // which is what opening any not-yet-blamed file used to do.
  it('hands back the same empty array every time a file has no blame', () => {
    const state = { blameByPath: {} };
    expect(selectBlameHunks(state, '/repo/src/a.ts')).toBe(
      selectBlameHunks(state, '/repo/src/a.ts')
    );
  });

  it('hands back the same empty array when there is no file path', () => {
    const state = { blameByPath: {} };
    expect(selectBlameHunks(state, undefined)).toBe(selectBlameHunks(state, undefined));
  });
});

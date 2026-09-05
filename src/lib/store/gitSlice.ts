import type { StateCreator } from 'zustand';
import { reviewCommentId, type ReviewComment } from '../git/reviewComments';
import { isStaged, isUnstagedTracked, isUntracked } from '../git/statusSplit';
import type { GitFileStatus, GitRepoRef, GitWorktree } from '../tauri/git';
import {
  discoverGitRepos,
  commitChanges,
  pushChanges,
  stageFiles,
  unstageFiles,
  gitLogSince,
  listGitBranches,
  getGitDiffRefFiles,
  gitBlame,
  listGitWorktrees,
  removeGitWorktree,
  gitDefaultBranch,
  mergeGitWorktreeIntoDefault,
} from '../tauri/git';
import type { ScmView, HunkNavDirection, GitRepoState, GitSlice } from './git/gitTypes';
import { EMPTY_REVIEW_STATE } from './git/gitTypes';
import {
  selectBlameHunks,
  selectRepoState,
  selectRepoForPath,
  selectChangedFileCount,
  selectBranchNameForPath,
} from './git/gitSelectors';
import {
  applyRepoStatus,
  pruneRepoStates,
  activeRepoChangeFields,
  seedRepoStates,
  pruneBlameByPath,
  setRepoField,
  fetchRepoStatus,
  fetchRepoStatusResilient,
} from './git/gitStateHelpers';

export type { ScmView, HunkNavDirection, GitRepoState, GitSlice };
export {
  selectBlameHunks,
  selectRepoState,
  selectRepoForPath,
  selectChangedFileCount,
  selectBranchNameForPath,
};

export const createGitSlice: StateCreator<GitSlice> = (set, get) => {
  /**
   * Writes a fetched status back only if `ref` is still a discovered repo.
   *
   * A repo's status fetch is in flight for the whole `await` — long enough for
   * a second, faster `discoverAndRefreshGit` call to prune that repo out from
   * under it. Without this check the first call's late-arriving write would
   * resurrect a repoStates entry for a repo that no longer exists.
   */
  const writeRepoStatus = (
    ref: GitRepoRef,
    fileStatuses: GitFileStatus[],
    branchInfo: import('../tauri/git').BranchInfo | null
  ) => {
    if (!get().repos.some((r) => r.path === ref.path)) return;
    set((s) => ({ repoStates: applyRepoStatus(s.repoStates, ref, fileStatuses, branchInfo) }));
  };

  return {
    repos: [],
    repoStates: {},
    activeRepoPath: null,
    projectDirtyEpoch: 0,
    bumpProjectDirtyEpoch: () => set((s) => ({ projectDirtyEpoch: s.projectDirtyEpoch + 1 })),
    diffByTabId: {},
    agentWorktrees: [],
    ...EMPTY_REVIEW_STATE,

    setActiveRepoPath: (repoPath) => {
      const current = get().activeRepoPath;
      if (current === repoPath) return;
      set(activeRepoChangeFields(current, repoPath));
    },

    discoverAndRefreshGit: async (rootPath) => {
      let repos: GitRepoRef[];
      try {
        repos = await discoverGitRepos(rootPath);
      } catch {
        repos = [];
      }

      const currentActive = get().activeRepoPath;
      const activeRepoPath =
        currentActive && repos.some((r) => r.path === currentActive)
          ? currentActive
          : (repos[0]?.path ?? null);

      set((s) => ({
        repos,
        repoStates: seedRepoStates(pruneRepoStates(s.repoStates, repos), repos),
        blameByPath: pruneBlameByPath(s.blameByPath, s.repos, repos),
        ...activeRepoChangeFields(currentActive, activeRepoPath),
      }));

      await Promise.all(
        repos.map(async (ref) => {
          const { fileStatuses, branchInfo } = await fetchRepoStatusResilient(ref.path);
          writeRepoStatus(ref, fileStatuses, branchInfo);
        })
      );
      await get().refreshAgentWorktrees();
    },

    refreshGitStatus: async () => {
      const { repos } = get();
      await Promise.all(
        repos.map(async (ref) => {
          const { fileStatuses, branchInfo } = await fetchRepoStatusResilient(ref.path);
          writeRepoStatus(ref, fileStatuses, branchInfo);
        })
      );
      await get().refreshAgentWorktrees();
    },

    refreshRepoStatus: async (repoPath) => {
      const ref = get().repos.find((r) => r.path === repoPath);
      if (!ref) return;
      const { fileStatuses, branchInfo } = await fetchRepoStatus(repoPath);
      writeRepoStatus(ref, fileStatuses, branchInfo);
    },

    setScmView: (view) => set({ scmView: view }),

    loadFileHistory: async (repoPath, filePath) => {
      set({ historyPath: filePath, historyLoading: true, historySelectedOid: null });
      try {
        const historyCommits = await gitLogSince(repoPath, undefined, filePath);
        set({ historyCommits, historyLoading: false });
      } catch {
        set({ historyCommits: [], historyLoading: false });
      }
    },

    setHistorySelectedOid: (oid) => set({ historySelectedOid: oid }),

    loadBranches: async (repoPath) => {
      const branches = await listGitBranches(repoPath);
      set({ branches });
    },

    loadCompare: async (repoPath, ref) => {
      set({ compareRef: ref, compareLoading: true });
      try {
        const compareFiles = await getGitDiffRefFiles(repoPath, ref);
        set({ compareFiles, compareLoading: false });
      } catch {
        set({ compareFiles: [], compareLoading: false });
      }
    },

    toggleBlame: () => set((s) => ({ blameVisible: !s.blameVisible })),

    loadBlame: async (repoPath, filePath) => {
      const key = `${repoPath}/${filePath}`;
      set({ blameLoading: true });
      try {
        const hunks = await gitBlame(repoPath, filePath);
        set((s) => ({
          blameByPath: { ...s.blameByPath, [key]: hunks },
          blameLoading: false,
        }));
      } catch {
        set((s) => ({
          blameByPath: { ...s.blameByPath, [key]: [] },
          blameLoading: false,
        }));
      }
    },

    requestHunkNav: (dir) =>
      set((s) => ({ hunkNavNonce: s.hunkNavNonce + 1, hunkNavDirection: dir })),

    setDiffTab: (tabId, state) =>
      set((s) => ({ diffByTabId: { ...s.diffByTabId, [tabId]: state } })),

    clearDiffTab: (tabId) =>
      set((s) => {
        if (!(tabId in s.diffByTabId)) return s;
        const next = { ...s.diffByTabId };
        delete next[tabId];
        return { diffByTabId: next };
      }),

    upsertReviewComment: (comment) => {
      const id = reviewCommentId(comment);
      const body = comment.body.trim();
      set((s) => {
        const without = s.reviewComments.filter((c) => c.id !== id);
        if (!body) return { reviewComments: without };
        const existing = s.reviewComments.find((c) => c.id === id);
        const next: ReviewComment = {
          ...comment,
          id,
          body,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        return { reviewComments: [...without, next] };
      });
      return id;
    },

    removeReviewComment: (id) =>
      set((s) => ({ reviewComments: s.reviewComments.filter((c) => c.id !== id) })),

    clearReviewComments: (repoPath) =>
      set((s) => ({
        reviewComments: repoPath ? s.reviewComments.filter((c) => c.repoPath !== repoPath) : [],
      })),

    resetGitInMemory: () =>
      set({
        diffByTabId: {},
        repos: [],
        repoStates: {},
        activeRepoPath: null,
        agentWorktrees: [],
        ...EMPTY_REVIEW_STATE,
      }),

    refreshAgentWorktrees: async () => {
      const { repos } = get();
      const listed = await Promise.all(
        repos.map(async (ref) => {
          try {
            return await listGitWorktrees(ref.path);
          } catch {
            return [] as GitWorktree[];
          }
        })
      );
      const seen = new Set<string>();
      const agentWorktrees: GitWorktree[] = [];
      for (const tree of listed.flat()) {
        if (seen.has(tree.path)) continue;
        seen.add(tree.path);
        agentWorktrees.push(tree);
      }
      agentWorktrees.sort((a, b) => a.name.localeCompare(b.name));
      set({ agentWorktrees });
    },

    removeAgentWorktree: async (worktreePath, force) => {
      const tree = get().agentWorktrees.find((wt) => wt.path === worktreePath);
      const repoPath = tree?.sourceRepo;
      if (!repoPath) {
        throw new Error('worktree not found');
      }
      await removeGitWorktree(repoPath, worktreePath, force);
      await get().refreshAgentWorktrees();
    },

    defaultBranchFor: async (repoPath) => gitDefaultBranch(repoPath),

    mergeAgentWorktree: async (worktreePath, commitMessage) => {
      const tree = get().agentWorktrees.find((wt) => wt.path === worktreePath);
      const repoPath = tree?.sourceRepo ?? worktreePath;
      const result = await mergeGitWorktreeIntoDefault(repoPath, worktreePath, commitMessage);
      await get().refreshAgentWorktrees();
      if (tree?.sourceRepo) {
        await get().refreshRepoStatus(tree.sourceRepo);
      }
      return result;
    },

    stageFile: async (repoPath, path) => {
      await stageFiles(repoPath, [path]);
      await get().refreshRepoStatus(repoPath);
    },

    stageAll: async (repoPath) => {
      // Only the unstaged side — already-fully-staged files stay out, deletions stay in.
      const paths = (get().repoStates[repoPath]?.fileStatuses ?? [])
        .filter((s) => s.status !== 'ignored' && (isUnstagedTracked(s) || isUntracked(s)))
        .map((s) => s.path);
      if (paths.length === 0) return;
      await stageFiles(repoPath, paths);
      await get().refreshRepoStatus(repoPath);
    },

    unstageFile: async (repoPath, path) => {
      await unstageFiles(repoPath, [path]);
      await get().refreshRepoStatus(repoPath);
    },

    unstageAll: async (repoPath) => {
      const paths = (get().repoStates[repoPath]?.fileStatuses ?? [])
        .filter(isStaged)
        .map((s) => s.path);
      if (paths.length === 0) return;
      await unstageFiles(repoPath, paths);
      await get().refreshRepoStatus(repoPath);
    },

    commit: async (repoPath) => {
      const repoState = get().repoStates[repoPath];
      const commitMessage = repoState?.commitMessage ?? '';
      if (!commitMessage.trim()) return null;

      set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isCommitting: true }) }));
      try {
        if (!(repoState?.fileStatuses ?? []).some(isStaged)) {
          await get().stageAll(repoPath);
        }
        const oid = await commitChanges(repoPath, commitMessage);
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { commitMessage: '' }) }));
        await get().refreshRepoStatus(repoPath);
        return oid;
      } finally {
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isCommitting: false }) }));
      }
    },

    push: async (repoPath) => {
      set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isPushing: true }) }));
      try {
        await pushChanges(repoPath);
        // The branch's ahead/behind display is what a push changes.
        await get().refreshRepoStatus(repoPath);
      } finally {
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { isPushing: false }) }));
      }
    },

    setCommitMessage: (repoPath, msg) =>
      set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { commitMessage: msg }) })),
  };
};

import type { StateCreator } from 'zustand';
import { patchForHunkAction } from '../git/hunkPatch';
import { commitRouteFor } from '../git/merge/commitRoute';
import type { GitMergeState } from '../tauri/gitMerge';
import { markCommentsSent, newReviewCommentId, type ReviewComment } from '../git/reviewComments';
import { isStaged, isUnstagedTracked, isUntracked } from '../git/statusSplit';
import type { BranchInfo, GitFileStatus, GitRepoRef, GitWorktree } from '../tauri/git';
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
  applyGitPatch,
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
import { sameValue } from './stableRefs';

export type { ScmView, HunkNavDirection, GitRepoState, GitSlice };

interface RepoStatusResult {
  ref: GitRepoRef;
  fileStatuses: GitFileStatus[];
  branchInfo: BranchInfo | null;
}
export {
  selectBlameHunks,
  selectRepoState,
  selectRepoForPath,
  selectChangedFileCount,
  selectBranchNameForPath,
};

/** What `commit` reads from the merge slice and the toasts, duck-typed like agentSlice does. */
interface CommitHost {
  mergeStates?: Record<string, GitMergeState>;
  concludeMerge?: (repoPath: string, message: string) => Promise<string>;
  showToast?: (message: string, variant?: 'info' | 'success' | 'error') => unknown;
}

export const createGitSlice: StateCreator<GitSlice> = (set, get) => {
  /**
   * Writes fetched statuses back, all repos in one store update, and only for
   * repos that are still discovered.
   *
   * A status fetch is in flight for the whole `await` — long enough for a
   * second, faster `discoverAndRefreshGit` call to prune that repo out from
   * under it. Without the check the first call's late-arriving write would
   * resurrect a repoStates entry for a repo that no longer exists. One update
   * instead of one per repo matters because every update re-renders what
   * subscribes to `repoStates`.
   */
  const writeRepoStatuses = (results: RepoStatusResult[]) => {
    const live = new Set(get().repos.map((r) => r.path));
    const current = results.filter((r) => live.has(r.ref.path));
    if (current.length === 0) return;
    set((s) => {
      let repoStates = s.repoStates;
      for (const r of current) {
        repoStates = applyRepoStatus(repoStates, r.ref, r.fileStatuses, r.branchInfo);
      }
      return repoStates === s.repoStates ? {} : { repoStates };
    });
  };

  const fetchAll = (repos: readonly GitRepoRef[]): Promise<RepoStatusResult[]> =>
    Promise.all(repos.map(async (ref) => ({ ref, ...(await fetchRepoStatusResilient(ref.path)) })));

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

      set((s) => {
        // An unchanged discovery keeps the old array, so `repos` subscribers
        // do not re-render on every root refresh.
        const nextRepos = sameValue(s.repos, repos) ? s.repos : repos;
        return {
          repos: nextRepos,
          repoStates: seedRepoStates(pruneRepoStates(s.repoStates, nextRepos), nextRepos),
          blameByPath: pruneBlameByPath(s.blameByPath, s.repos, nextRepos),
          ...activeRepoChangeFields(currentActive, activeRepoPath),
        };
      });

      writeRepoStatuses(await fetchAll(get().repos));
      await get().refreshAgentWorktrees();
    },

    refreshGitStatus: async () => {
      writeRepoStatuses(await fetchAll(get().repos));
      await get().refreshAgentWorktrees();
    },

    refreshRepoStatus: async (repoPath) => {
      const ref = get().repos.find((r) => r.path === repoPath);
      if (!ref) return;
      const { fileStatuses, branchInfo } = await fetchRepoStatus(repoPath);
      writeRepoStatuses([{ ref, fileStatuses, branchInfo }]);
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

    addReviewComment: (comment) => {
      const body = comment.body.trim();
      if (!body) return null;
      const next: ReviewComment = {
        ...comment,
        id: newReviewCommentId(),
        body,
        createdAt: Date.now(),
      };
      set((s) => ({ reviewComments: [...s.reviewComments, next] }));
      return next.id;
    },

    editReviewComment: (id, body) => {
      const existing = get().reviewComments.find((c) => c.id === id);
      if (!existing || existing.sentInRound !== undefined) return false;
      const trimmed = body.trim();
      set((s) => ({
        reviewComments: trimmed
          ? s.reviewComments.map((c) => (c.id === id ? { ...c, body: trimmed } : c))
          : s.reviewComments.filter((c) => c.id !== id),
      }));
      return true;
    },

    removeReviewComment: (id) =>
      set((s) => ({ reviewComments: s.reviewComments.filter((c) => c.id !== id) })),

    clearReviewComments: (repoPath) =>
      set((s) => ({
        reviewComments: repoPath ? s.reviewComments.filter((c) => c.repoPath !== repoPath) : [],
      })),

    markReviewCommentsSent: (repoPath, round) =>
      set((s) => {
        const next = markCommentsSent(s.reviewComments, repoPath, round);
        return next === s.reviewComments ? s : { reviewComments: next };
      }),

    requestCommitFocus: (repoPath) =>
      set((s) => ({
        commitFocusRequest: { repoPath, nonce: (s.commitFocusRequest?.nonce ?? 0) + 1 },
      })),

    clearCommitFocusRequest: (nonce) =>
      set((s) => (s.commitFocusRequest?.nonce === nonce ? { commitFocusRequest: null } : s)),

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
      if (!sameValue(get().agentWorktrees, agentWorktrees)) set({ agentWorktrees });
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

    applyHunkAction: async (repoPath, filePath, rawPatch, hunkIndex, action) => {
      const cut = patchForHunkAction(rawPatch, hunkIndex, action);
      if (!cut) throw new Error(`Could not ${action} this hunk of ${filePath} on its own.`);
      // The hunk was cut from this diff; git refuses if that side moved on since.
      const side = action === 'unstage' ? 'staged' : 'unstaged';
      try {
        await applyGitPatch(repoPath, cut.patch, cut.target, {
          filePath,
          side,
          diff: rawPatch,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not ${action} the hunk in ${filePath}: ${detail}`);
      } finally {
        // On refusal too: the file moved on, and the diff should show where it is now.
        await get().refreshRepoStatus(repoPath);
      }
    },

    commit: async (repoPath) => {
      const repoState = get().repoStates[repoPath];
      const host = get() as GitSlice & CommitHost;
      const mergeState = host.mergeStates?.[repoPath];
      const route = commitRouteFor(mergeState, { agentic: false });
      if (route.kind === 'refuse') {
        host.showToast?.(route.message, 'error');
        return null;
      }
      if (route.kind === 'conclude-merge' && host.concludeMerge) {
        // MERGE_MSG stands in for an empty box, as `git commit` would use it.
        const message = repoState?.commitMessage.trim() || mergeState?.message?.trim() || '';
        if (!message) return null;
        const oid = await host.concludeMerge(repoPath, message);
        set((s) => ({ repoStates: setRepoField(s.repoStates, repoPath, { commitMessage: '' }) }));
        return oid;
      }
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

import { repoForPath } from '../../git/repos';
import type { BlameHunk, BranchInfo, GitFileStatus, GitRepoRef } from '../../tauri/git';
import { getBranchInfo, getGitStatus } from '../../tauri/git';
import type { GitRepoState, GitSlice } from './gitTypes';

/** Merges a fetched status into `states`, keeping that repo's commit-box UI state untouched. */
export function applyRepoStatus(
  states: Record<string, GitRepoState>,
  ref: GitRepoRef,
  fileStatuses: GitFileStatus[],
  branchInfo: BranchInfo | null
): Record<string, GitRepoState> {
  const prev = states[ref.path];
  return {
    ...states,
    [ref.path]: {
      ref,
      branchInfo,
      fileStatuses,
      commitMessage: prev?.commitMessage ?? '',
      isCommitting: prev?.isCommitting ?? false,
      isPushing: prev?.isPushing ?? false,
    },
  };
}

/** Drops any repoStates entry whose repo is no longer among the discovered ones. */
export function pruneRepoStates(
  states: Record<string, GitRepoState>,
  repos: readonly GitRepoRef[]
): Record<string, GitRepoState> {
  const discoveredPaths = new Set(repos.map((r) => r.path));
  const pruned: Record<string, GitRepoState> = {};
  let changed = false;
  for (const [path, repoState] of Object.entries(states)) {
    if (discoveredPaths.has(path)) {
      pruned[path] = repoState;
    } else {
      changed = true;
    }
  }
  return changed ? pruned : states;
}

/**
 * Fields to merge when the active repo changes. History and compare are a
 * view into one repo's log/refs — carrying them past a repo switch would
 * label the previous repo's commits as the new repo's. When `nextActive`
 * equals `currentActive` (survives a rediscovery, or a redundant call), that
 * state is left alone entirely: no fields beyond `activeRepoPath` are
 * returned, so `set()` doesn't touch — or churn a re-render over — anything
 * that didn't actually change. Blame and diff tabs are untouched either way;
 * they're already keyed per file/repo.
 */
export function activeRepoChangeFields(
  currentActive: string | null,
  nextActive: string | null
): Pick<GitSlice, 'activeRepoPath'> &
  Partial<
    Pick<
      GitSlice,
      | 'historyPath'
      | 'historyCommits'
      | 'historySelectedOid'
      | 'historyLoading'
      | 'branches'
      | 'compareRef'
      | 'compareFiles'
      | 'compareLoading'
    >
  > {
  if (currentActive === nextActive) {
    return { activeRepoPath: nextActive };
  }
  return {
    activeRepoPath: nextActive,
    historyPath: null,
    historyCommits: [],
    historySelectedOid: null,
    historyLoading: false,
    branches: [],
    compareRef: null,
    compareFiles: [],
    compareLoading: false,
  };
}

/**
 * Seeds a placeholder `GitRepoState` for every discovered repo that doesn't
 * have one yet, keeping existing entries as-is.
 *
 * `discoverAndRefreshGit` writes `repos` immediately but the status IPC for
 * each repo is still in flight for a moment after — without a seeded entry,
 * `setRepoField` (which `setCommitMessage` etc. go through) finds nothing to
 * merge into and silently no-ops, so a keystroke typed into a freshly
 * discovered repo's commit box during that window is dropped on the floor.
 */
export function seedRepoStates(
  states: Record<string, GitRepoState>,
  repos: readonly GitRepoRef[]
): Record<string, GitRepoState> {
  const missing = repos.filter((ref) => !states[ref.path]);
  if (missing.length === 0) return states;
  const seeded = { ...states };
  for (const ref of missing) {
    seeded[ref.path] = {
      ref,
      branchInfo: null,
      fileStatuses: [],
      commitMessage: '',
      isCommitting: false,
      isPushing: false,
    };
  }
  return seeded;
}

/**
 * Drops blame entries whose owning repo is gone.
 *
 * A blame key is just an absolute path — it doesn't say which repo it came
 * from. Checking "is this path under any currently discovered repo" isn't
 * enough to answer that: in the common root-plus-nested-service layout the
 * root repo's path prefixes every nested repo's files too, so a file whose
 * *own* (nested) repo just vanished would still read as "under the root
 * repo" and never get pruned. Resolving the deepest match against the repos
 * as they were *before* this rediscovery recovers which repo actually owned
 * the path, so pruning can check that specific repo, not just any ancestor.
 */
export function pruneBlameByPath(
  blameByPath: Record<string, BlameHunk[]>,
  previousRepos: readonly GitRepoRef[],
  repos: readonly GitRepoRef[]
): Record<string, BlameHunk[]> {
  const discoveredPaths = new Set(repos.map((r) => r.path));
  const pruned: Record<string, BlameHunk[]> = {};
  let changed = false;
  for (const [absPath, hunks] of Object.entries(blameByPath)) {
    const owningRepo = repoForPath(absPath, previousRepos);
    const stillTracked = owningRepo !== null && discoveredPaths.has(owningRepo.path);
    if (stillTracked) {
      pruned[absPath] = hunks;
    } else {
      changed = true;
    }
  }
  return changed ? pruned : blameByPath;
}

export function setRepoField(
  states: Record<string, GitRepoState>,
  repoPath: string,
  patch: Partial<GitRepoState>
): Record<string, GitRepoState> {
  const existing = states[repoPath];
  if (!existing) return states;
  return { ...states, [repoPath]: { ...existing, ...patch } };
}

export async function fetchRepoStatus(
  repoPath: string
): Promise<{ fileStatuses: GitFileStatus[]; branchInfo: BranchInfo | null }> {
  const [fileStatuses, branchInfo] = await Promise.all([
    getGitStatus(repoPath),
    getBranchInfo(repoPath),
  ]);
  return { fileStatuses, branchInfo };
}

/** Settles independently — one repo's failure keeps `[]`/`null` without dropping the others. */
export async function fetchRepoStatusResilient(
  repoPath: string
): Promise<{ fileStatuses: GitFileStatus[]; branchInfo: BranchInfo | null }> {
  try {
    return await fetchRepoStatus(repoPath);
  } catch {
    return { fileStatuses: [], branchInfo: null };
  }
}

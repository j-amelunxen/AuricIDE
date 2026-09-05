import { repoForPath } from '../../git/repos';
import type { BlameHunk, GitRepoRef } from '../../tauri/git';
import type { GitRepoState } from './gitTypes';

/**
 * One array for every file that has no blame yet.
 *
 * `useStore` runs its selector on every snapshot check and compares the result
 * by identity, so a selector that builds its own empty array reports a changed
 * store on each pass — the component re-renders, the selector answers with
 * another new array, and React stops the loop by throwing. Sharing one instance
 * is what keeps "no blame loaded" a stable answer.
 */
const NO_BLAME_HUNKS: BlameHunk[] = [];

/** Blame for the file behind a tab, addressed by its absolute path. */
export function selectBlameHunks(
  state: { blameByPath: Record<string, BlameHunk[]> },
  filePath: string | undefined
): BlameHunk[] {
  if (!filePath) return NO_BLAME_HUNKS;
  return state.blameByPath[filePath] ?? NO_BLAME_HUNKS;
}

export function selectRepoState(
  state: { repoStates: Record<string, GitRepoState> },
  repoPath: string
): GitRepoState | undefined {
  return state.repoStates[repoPath];
}

export function selectRepoForPath(
  state: { repos: GitRepoRef[] },
  absPath: string
): GitRepoRef | null {
  return repoForPath(absPath, state.repos);
}

/** All repos, ignored excluded — the sidebar badge. */
export function selectChangedFileCount(state: {
  repoStates: Record<string, GitRepoState>;
}): number {
  let count = 0;
  for (const repoState of Object.values(state.repoStates)) {
    for (const status of repoState.fileStatuses) {
      if (status.status !== 'ignored') count += 1;
    }
  }
  return count;
}

/** The path's own repo, else the root repo, else the first repo, else null. */
export function selectBranchNameForPath(
  state: { repos: GitRepoRef[]; repoStates: Record<string, GitRepoState> },
  absPath: string | null
): string | null {
  const repoOfPath = absPath ? repoForPath(absPath, state.repos) : null;
  const rootRepo = state.repos.find((r) => r.kind === 'root') ?? null;
  const repo = repoOfPath ?? rootRepo ?? state.repos[0] ?? null;
  if (!repo) return null;
  return state.repoStates[repo.path]?.branchInfo?.name ?? null;
}

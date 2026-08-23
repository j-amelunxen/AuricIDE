import type { GitRepoRef } from '@/lib/tauri/git';
import { exists } from '@/lib/tauri/fs';

function stripSlash(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.endsWith('/') && normalized !== '/' ? normalized.slice(0, -1) : normalized;
}

/**
 * True when `workingDirectory` is itself a known git work-tree — not merely
 * a folder inside one. Worktree add opens that path as a repo, so a nested
 * source file must not count.
 */
export function isGitRepoRoot(workingDirectory: string, repos: readonly GitRepoRef[]): boolean {
  const target = stripSlash(workingDirectory);
  if (!target) return false;
  return repos.some((repo) => stripSlash(repo.path) === target);
}

/**
 * Whether this working directory can take a new git worktree. Known repo
 * roots win without a disk probe; otherwise we look for `.git` at that path
 * (directory or file — same rule as discovery).
 */
export async function workingDirectoryHasGitRepo(
  workingDirectory: string,
  knownRepos: readonly GitRepoRef[] = []
): Promise<boolean> {
  if (isGitRepoRoot(workingDirectory, knownRepos)) return true;
  const target = stripSlash(workingDirectory);
  if (!target) return false;
  try {
    return await exists(`${target}/.git`);
  } catch {
    return false;
  }
}

/**
 * What the "New git worktree" box shows. Three answers, in the order they
 * outrank each other: the user's own toggle, then a pin from whatever opened
 * the dialog, then whether the working directory is a git repo at all.
 *
 * The pin exists because a skill launched from Quick Access is aimed at the
 * repository the user is looking at — `/commit` in a fresh detached worktree
 * commits nothing they will see. Only the launch knows that; the folder looks
 * the same either way.
 */
export function resolveUseWorktree(input: {
  override?: boolean | null;
  pinned?: boolean | null;
  hasGitRepo: boolean;
}): boolean {
  return input.override ?? input.pinned ?? input.hasGitRepo;
}

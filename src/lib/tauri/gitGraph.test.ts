import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

import {
  getGitDiffCommitAtParent,
  gitBranchCreate,
  gitBranchDelete,
  gitBranchRename,
  gitCheckout,
  gitCherryPick,
  gitCommitDetail,
  gitGraphLog,
  gitRefs,
  gitRevert,
  gitTagCreate,
  gitTagDelete,
  parseGitError,
  UNKNOWN_GIT_ERROR_MESSAGE,
} from './gitGraph';

describe('git graph IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  const calls: Array<[string, () => Promise<unknown>, string, Record<string, unknown>]> = [
    [
      'gitGraphLog',
      () => gitGraphLog('/r', 40, 200),
      'git_graph_log',
      { repoPath: '/r', skip: 40, limit: 200 },
    ],
    ['gitRefs', () => gitRefs('/r'), 'git_refs', { repoPath: '/r' }],
    [
      'gitCommitDetail',
      () => gitCommitDetail('/r', 'abc', 1),
      'git_commit_detail',
      { repoPath: '/r', oid: 'abc', parentIndex: 1 },
    ],
    [
      'getGitDiffCommitAtParent',
      () => getGitDiffCommitAtParent('/r', 'abc', 'a.ts', 1),
      'git_diff_commit',
      { repoPath: '/r', oid: 'abc', filePath: 'a.ts', parentIndex: 1 },
    ],
    [
      'gitCheckout',
      () => gitCheckout('/r', 'refs/heads/main'),
      'git_checkout',
      { repoPath: '/r', target: 'refs/heads/main' },
    ],
    [
      'gitBranchCreate',
      () => gitBranchCreate('/r', 'feat', 'abc', true),
      'git_branch_create',
      { repoPath: '/r', name: 'feat', atOid: 'abc', checkout: true },
    ],
    [
      'gitBranchRename',
      () => gitBranchRename('/r', 'old', 'new'),
      'git_branch_rename',
      { repoPath: '/r', oldName: 'old', newName: 'new' },
    ],
    [
      'gitBranchDelete',
      () => gitBranchDelete('/r', 'feat', true),
      'git_branch_delete',
      { repoPath: '/r', name: 'feat', force: true },
    ],
    [
      'gitTagCreate',
      () => gitTagCreate('/r', 'v1', 'abc', 'release'),
      'git_tag_create',
      { repoPath: '/r', name: 'v1', oid: 'abc', message: 'release' },
    ],
    [
      'gitTagDelete',
      () => gitTagDelete('/r', 'v1'),
      'git_tag_delete',
      { repoPath: '/r', name: 'v1' },
    ],
    [
      'gitCherryPick',
      () => gitCherryPick('/r', 'abc'),
      'git_cherry_pick',
      { repoPath: '/r', oid: 'abc' },
    ],
    ['gitRevert', () => gitRevert('/r', 'abc'), 'git_revert', { repoPath: '/r', oid: 'abc' }],
  ];

  it.each(calls)('%s invokes its command with camelCase args', async (_n, call, command, args) => {
    await call();
    expect(mockInvoke).toHaveBeenCalledWith(command, args);
  });

  it('returns what the command returned', async () => {
    const page = { commits: [], hasMore: true };
    mockInvoke.mockResolvedValueOnce(page);
    await expect(gitGraphLog('/r', 0, 10)).resolves.toBe(page);
  });

  it('lets the backend refusal through unchanged', async () => {
    mockInvoke.mockRejectedValueOnce('not_merged: nope');
    await expect(gitBranchDelete('/r', 'b', false)).rejects.toBe('not_merged: nope');
  });
});

describe('parseGitError', () => {
  it.each([
    ['not_merged: This branch has commits that exist nowhere else.', 'not_merged'],
    ['already_applied: Nothing to apply.', 'already_applied'],
    ['would_overwrite: Your changes to a.ts would be lost.', 'would_overwrite'],
    ['operation_in_progress: Finish the cherry-pick first.', 'operation_in_progress'],
  ])('splits "%s"', (raw, code) => {
    const parsed = parseGitError(raw);
    expect(parsed.code).toBe(code);
    expect(parsed.message).toBe(raw.slice(code.length + 2));
  });

  it('reads an Error the same way as a string', () => {
    expect(parseGitError(new Error('invalid_name: Spaces are not allowed.'))).toEqual({
      code: 'invalid_name',
      message: 'Spaces are not allowed.',
    });
  });

  it('keeps colons inside the sentence', () => {
    expect(parseGitError('git_failed: Could not run: git is missing.').message).toBe(
      'Could not run: git is missing.'
    );
  });

  it('turns an unknown code, plain text or a non-string into the fixed sentence, never the raw text', () => {
    for (const raw of [
      'weird_code: x',
      'fatal: bad object deadbeef',
      'no prefix at all',
      42,
      null,
    ]) {
      expect(parseGitError(raw)).toEqual({ code: 'unknown', message: UNKNOWN_GIT_ERROR_MESSAGE });
    }
  });

  it('falls back to the fixed sentence when a known code has no sentence', () => {
    expect(parseGitError('git_failed: ')).toEqual({
      code: 'git_failed',
      message: UNKNOWN_GIT_ERROR_MESSAGE,
    });
  });
});

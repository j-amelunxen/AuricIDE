import { describe, expect, it, vi } from 'vitest';
import { offerWorktreeMerge } from './offerWorktreeMerge';
import type { GitWorktree } from '@/lib/tauri/git';

const tree: GitWorktree = {
  path: '/w.auric-wt/fix-ab12',
  name: 'fix-ab12',
  branch: 'auric/fix-ab12',
  sourceRepo: '/w',
  isAuric: true,
  dirty: false,
  branchAhead: true,
};

const agent = { name: 'Writer', repoPath: tree.path };

function deps(overrides: Partial<Parameters<typeof offerWorktreeMerge>[0]> = {}) {
  return {
    agent,
    worktrees: [tree],
    confirm: vi.fn(async () => true),
    defaultBranchFor: vi.fn(async () => 'main'),
    mergeAgentWorktree: vi.fn(async () => ({
      defaultBranch: 'main',
      merged: true,
      fastForward: true,
      cleanedUp: true,
      oid: 'abc',
    })),
    showToast: vi.fn(),
    ...overrides,
  };
}

describe('offerWorktreeMerge', () => {
  it('does nothing for an agent that is not on a worktree', async () => {
    const input = deps({ agent: { name: 'Writer', repoPath: '/w' } });
    await offerWorktreeMerge(input);
    expect(input.confirm).not.toHaveBeenCalled();
    expect(input.mergeAgentWorktree).not.toHaveBeenCalled();
  });

  it('asks using the repo default branch, main or master', async () => {
    const main = deps({ defaultBranchFor: vi.fn(async () => 'main') });
    await offerWorktreeMerge(main);
    expect(main.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Merge into main?',
        confirmLabel: 'Merge',
      })
    );

    const master = deps({ defaultBranchFor: vi.fn(async () => 'master') });
    await offerWorktreeMerge(master);
    expect(master.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Merge into master?' })
    );
  });

  it('names the worktree branch in the question', async () => {
    const input = deps();
    await offerWorktreeMerge(input);
    expect(input.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('auric/fix-ab12'),
      })
    );
  });

  it('mentions a commit when the worktree is dirty', async () => {
    const input = deps({
      worktrees: [{ ...tree, dirty: true }],
    });
    await offerWorktreeMerge(input);
    expect(input.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/uncommitted/i),
      })
    );
  });

  it('merges and toasts when the user says yes', async () => {
    const input = deps();
    await offerWorktreeMerge(input);
    expect(input.mergeAgentWorktree).toHaveBeenCalledWith(tree.path, 'Agent work: Writer');
    expect(input.showToast).toHaveBeenCalledWith(
      'Merged into main and removed the worktree.',
      'success'
    );
  });

  it('does not merge when the user says no', async () => {
    const input = deps({ confirm: vi.fn(async () => false) });
    await offerWorktreeMerge(input);
    expect(input.mergeAgentWorktree).not.toHaveBeenCalled();
    expect(input.showToast).not.toHaveBeenCalled();
  });

  it('toasts and keeps the worktree when the merge fails', async () => {
    const input = deps({
      mergeAgentWorktree: vi.fn(async () => {
        throw new Error('merge conflict in a.txt');
      }),
    });
    await offerWorktreeMerge(input);
    expect(input.showToast).toHaveBeenCalledWith(
      'Could not merge: merge conflict in a.txt',
      'error'
    );
  });

  it('toasts when main or master cannot be found, and does not ask', async () => {
    const input = deps({
      defaultBranchFor: vi.fn(async () => {
        throw new Error('could not determine default branch (main or master)');
      }),
    });
    await offerWorktreeMerge(input);
    expect(input.confirm).not.toHaveBeenCalled();
    expect(input.mergeAgentWorktree).not.toHaveBeenCalled();
    expect(input.showToast).toHaveBeenCalledWith(
      expect.stringContaining('main or master'),
      'error'
    );
  });

  it('still offers a merge when the worktree list has not caught up', async () => {
    const input = deps({ worktrees: [] });
    await offerWorktreeMerge(input);
    expect(input.defaultBranchFor).toHaveBeenCalledWith(tree.path);
    expect(input.confirm).toHaveBeenCalled();
  });
});

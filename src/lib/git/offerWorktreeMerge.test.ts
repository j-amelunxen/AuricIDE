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
      conflicts: [] as string[],
    })),
    onConflicts: vi.fn(),
    commitSubjectFor: vi.fn(async () => 'Cache the repo discovery walk'),
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
        confirmLabel: 'Merge & push main',
        secondaryLabel: 'Merge locally',
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
    expect(input.mergeAgentWorktree).toHaveBeenCalledWith(
      tree.path,
      'Cache the repo discovery walk',
      true
    );
    expect(input.showToast).toHaveBeenCalledWith(
      'Merged locally into main (not pushed). Worktree removed.',
      'success'
    );
  });

  it('commits under a written subject, not under the prompt that started the agent', async () => {
    const input = deps({
      agent: { name: 'was ist hier los seit 24 stunden', repoPath: tree.path },
    });
    await offerWorktreeMerge(input);
    expect(input.commitSubjectFor).toHaveBeenCalledWith(
      tree.path,
      'was ist hier los seit 24 stunden'
    );
    expect(input.mergeAgentWorktree).toHaveBeenCalledWith(
      tree.path,
      'Cache the repo discovery walk',
      true
    );
  });

  it('writes no subject before the user has agreed to merge', async () => {
    const input = deps({ confirm: vi.fn(async () => false) });
    await offerWorktreeMerge(input);
    expect(input.commitSubjectFor).not.toHaveBeenCalled();
  });

  it('still merges when the subject cannot be written', async () => {
    const input = deps({
      commitSubjectFor: vi.fn(async () => {
        throw new Error('llm unreachable');
      }),
    });
    await offerWorktreeMerge(input);
    expect(input.mergeAgentWorktree).toHaveBeenCalledWith(tree.path, 'Agent work: Writer', true);
    expect(input.showToast).toHaveBeenCalledWith(
      'Merged locally into main (not pushed). Worktree removed.',
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

  it('hands a conflicted merge to the merge panel instead of claiming success', async () => {
    const input = deps({
      mergeAgentWorktree: vi.fn(async () => ({
        defaultBranch: 'main',
        merged: false,
        fastForward: false,
        cleanedUp: false,
        oid: null,
        conflicts: ['a.ts', 'b.ts'],
      })),
    });
    await offerWorktreeMerge(input);
    expect(input.onConflicts).toHaveBeenCalledWith('/w', ['a.ts', 'b.ts']);
    expect(input.showToast).toHaveBeenCalledTimes(1);
    expect(input.showToast).toHaveBeenCalledWith(
      'Merge stopped on 2 conflicting files. Resolve them in the merge panel.',
      'info'
    );
  });

  it('says file, not files, for a single conflict', async () => {
    const input = deps({
      mergeAgentWorktree: vi.fn(async () => ({
        defaultBranch: 'main',
        merged: false,
        fastForward: false,
        cleanedUp: false,
        oid: null,
        conflicts: ['a.ts'],
      })),
    });
    await offerWorktreeMerge(input);
    expect(input.showToast).toHaveBeenCalledWith(
      'Merge stopped on 1 conflicting file. Resolve it in the merge panel.',
      'info'
    );
  });
});

describe('worktree merge outcomes', () => {
  it('selects local-only through the secondary action', async () => {
    const input = deps({
      confirm: vi.fn(async (request) => {
        request.onSecondary?.();
        return true;
      }),
    });
    await offerWorktreeMerge(input);
    expect(input.mergeAgentWorktree).toHaveBeenCalledWith(tree.path, expect.any(String), false);
  });

  it.each([
    [{ pushed: true }, 'Merged into main and pushed to origin. Worktree removed.', 'success'],
    [{ merged: false }, 'Already merged into main (not pushed). Worktree removed.', 'info'],
    [
      { merged: false, pushed: true },
      'Already merged into main; pushed to origin. Worktree removed.',
      'info',
    ],
    [
      { cleanedUp: false, cleanupError: 'locked' },
      'Merged locally into main (not pushed). Could not remove the worktree: locked.',
      'error',
    ],
    [
      { cleanedUp: false, pushError: 'rejected' },
      'Merged locally into main, but push to origin failed: rejected. Local merge and worktree kept.',
      'error',
    ],
    [
      { pushed: true, remoteBranchError: 'denied' },
      'Merged into main and pushed to origin. Worktree removed. Could not delete the remote agent branch: denied.',
      'error',
    ],
  ])('reports the actual outcome %j', async (extra, message, variant) => {
    const base = await deps().mergeAgentWorktree(tree.path);
    const input = deps({ mergeAgentWorktree: vi.fn(async () => ({ ...base, ...extra })) });
    await offerWorktreeMerge(input);
    expect(input.showToast).toHaveBeenCalledWith(message, variant);
  });
});

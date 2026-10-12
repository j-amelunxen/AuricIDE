import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeTabId } from '@/lib/git/mergeTabId';
import { useStore } from '@/lib/store';
import { menuPlaceFor, MergeBranchMenu, mergeOutcomeMessage } from './MergeBranchMenu';

vi.mock('@/lib/tauri/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/git')>()),
  listGitBranches: vi.fn(async () => [
    { name: 'main', kind: 'local', isCurrent: true },
    { name: 'feature/x', kind: 'local', isCurrent: false },
    { name: 'origin/main', kind: 'remote', isCurrent: false },
  ]),
}));

const gitMerge = vi.hoisted(() => ({
  previewMerge: vi.fn(async () => ({ outcome: 'clean', conflicts: [] as string[], commits: 2 })),
}));
vi.mock('@/lib/tauri/gitMerge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/gitMerge')>()),
  previewMerge: gitMerge.previewMerge,
}));

const REPO = '/work/app';
const mergeBranch = vi.fn();
const openConflict = vi.fn(async (repo: string, file: string) => mergeTabId(repo, file));
const showToast = vi.fn(() => 1);

describe('MergeBranchMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ mergeBranch, openConflict, showToast, openTabs: [] });
  });

  it('says what each outcome did', () => {
    const base = { oid: null, conflicts: [] };
    expect(mergeOutcomeMessage({ ...base, outcome: 'up-to-date' }, 'x', 'main').text).toBe(
      'main already contains x. Nothing to merge.'
    );
    expect(mergeOutcomeMessage({ ...base, outcome: 'fast-forward' }, 'x', 'main')).toEqual({
      text: 'Fast-forwarded main to x.',
      variant: 'success',
    });
    expect(
      mergeOutcomeMessage({ ...base, outcome: 'conflicts', conflicts: ['a'] }, 'x', 'main').text
    ).toBe('1 file conflicts. Opening the first one.');
  });

  it('lists other local branches only and opens the first conflict after a merge stops', async () => {
    mergeBranch.mockResolvedValue({ outcome: 'conflicts', oid: null, conflicts: ['src/a.ts'] });
    const user = userEvent.setup();
    render(<MergeBranchMenu repoPath={REPO} currentBranch="main" />);

    await user.click(screen.getByRole('button', { name: 'Merge into main…' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('feature/x');
    expect(items[0]).toHaveFocus();

    await user.click(items[0]);
    expect(mergeBranch).toHaveBeenCalledWith(REPO, 'feature/x');
    await waitFor(() =>
      expect(useStore.getState().openTabs.map((t) => t.id)).toEqual([mergeTabId(REPO, 'src/a.ts')])
    );
    expect(showToast).toHaveBeenCalledWith('1 file conflicts. Opening the first one.', 'info');
  });

  it('shows a refusal as an error toast', async () => {
    mergeBranch.mockRejectedValue(new Error('working tree has uncommitted changes'));
    const user = userEvent.setup();
    render(<MergeBranchMenu repoPath={REPO} currentBranch="main" />);

    await user.click(screen.getByRole('button', { name: 'Merge into main…' }));
    await user.click(await screen.findByRole('menuitem', { name: /feature\/x/ }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Could not merge feature/x: working tree has uncommitted changes',
        'error'
      )
    );
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    const user = userEvent.setup();
    render(<MergeBranchMenu repoPath={REPO} currentBranch="main" />);
    const trigger = screen.getByRole('button', { name: 'Merge into main…' });

    await user.click(trigger);
    await screen.findAllByRole('menuitem');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('previews a branch on focus, once per branch, before anything is merged', async () => {
    const user = userEvent.setup();
    render(<MergeBranchMenu repoPath={REPO} currentBranch="main" />);

    await user.click(screen.getByRole('button', { name: 'Merge into main…' }));
    const item = await screen.findByRole('menuitem', { name: /feature\/x/ });
    await waitFor(() => expect(item).toHaveTextContent('2 commits · merges cleanly'));
    expect(gitMerge.previewMerge).toHaveBeenCalledWith(REPO, 'feature/x');

    await user.hover(item);
    item.blur();
    item.focus();
    await new Promise((r) => setTimeout(r, 250));
    expect(gitMerge.previewMerge).toHaveBeenCalledTimes(1);
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('names the conflicting files before a merge that will conflict, and asks first', async () => {
    gitMerge.previewMerge.mockResolvedValue({
      outcome: 'conflicts',
      conflicts: ['src/a.ts', 'ci/b.yml'],
      commits: 3,
    });
    mergeBranch.mockResolvedValue({
      outcome: 'conflicts',
      oid: null,
      conflicts: ['ci/b.yml', 'src/a.ts'],
    });
    const user = userEvent.setup();
    render(<MergeBranchMenu repoPath={REPO} currentBranch="main" />);

    await user.click(screen.getByRole('button', { name: 'Merge into main…' }));
    const item = await screen.findByRole('menuitem', { name: /feature\/x/ });
    await waitFor(() => expect(item).toHaveTextContent('Conflicts in 2 files: a.ts, b.yml'));

    await user.click(item);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('src/a.ts, ci/b.yml');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mergeBranch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Merge into main…' }));
    await user.click(await screen.findByRole('menuitem', { name: /feature\/x/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Merge and resolve' })
    );
    await waitFor(() => expect(mergeBranch).toHaveBeenCalledWith(REPO, 'feature/x'));
  });

  it('merges a clean branch without asking', async () => {
    gitMerge.previewMerge.mockResolvedValue({ outcome: 'clean', conflicts: [], commits: 1 });
    mergeBranch.mockResolvedValue({ outcome: 'merged', oid: 'abc', conflicts: [] });
    const user = userEvent.setup();
    render(<MergeBranchMenu repoPath={REPO} currentBranch="main" />);

    await user.click(screen.getByRole('button', { name: 'Merge into main…' }));
    await user.click(await screen.findByRole('menuitem', { name: /feature\/x/ }));
    await waitFor(() => expect(mergeBranch).toHaveBeenCalledWith(REPO, 'feature/x'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('menuPlaceFor', () => {
  const trigger = (left: number, right: number, bottom = 100) => ({
    getBoundingClientRect: () => ({ left, right, bottom, top: bottom - 20 }) as DOMRect,
  });

  it('aligns the right edges under the trigger', () => {
    expect(menuPlaceFor(trigger(500, 600), 1200)).toEqual({ top: 104, left: 344, width: 256 });
  });

  it('stays inside the window when the trigger sits in a narrow left sidebar', () => {
    expect(menuPlaceFor(trigger(120, 180), 1200)?.left).toBe(8);
  });

  it('shrinks to the window on a very narrow window', () => {
    expect(menuPlaceFor(trigger(100, 200), 240)).toEqual({ top: 104, left: 8, width: 224 });
  });

  it('has no place without a trigger', () => {
    expect(menuPlaceFor(null, 1200)).toBeNull();
  });
});

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeTabId } from '@/lib/git/mergeTabId';
import { useStore } from '@/lib/store';
import type { GitMergeState } from '@/lib/tauri/gitMerge';
import { MergeBanner } from './MergeBanner';

const REPO = '/work/app';

const merging: GitMergeState = {
  inProgress: true,
  operation: 'merge',
  oursLabel: 'main',
  theirsLabel: 'feature/x',
  theirsOid: 'abc1234',
  message: "Merge branch 'feature/x'",
  conflicts: [
    { path: 'src/a.ts', kind: 'content' },
    { path: 'src/b.png', kind: 'binary' },
  ],
};

const abortMerge = vi.fn(async () => undefined);
const concludeMerge = vi.fn(async () => 'deadbeefcafe');
const stepOperation = vi.fn();
const openConflict = vi.fn(async (repo: string, file: string) => mergeTabId(repo, file));
const showToast = vi.fn(() => 1);
const setInitialAgentTask = vi.fn();
const setSpawnDialogOpen = vi.fn();
const setSpawnAgentRepoPath = vi.fn();

function seed(state: GitMergeState | null) {
  useStore.setState({ mergeStates: state ? { [REPO]: state } : {} });
}

describe('MergeBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      abortMerge,
      concludeMerge,
      stepOperation,
      openConflict,
      showToast,
      setInitialAgentTask,
      setSpawnDialogOpen,
      setSpawnAgentRepoPath,
      openTabs: [],
    });
    seed(null);
  });

  it('appears when a merge shows up after mount and prefills the message once', () => {
    const onMessage = vi.fn();
    const { container, rerender } = render(
      <MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={onMessage} />
    );
    expect(container).toBeEmptyDOMElement();

    act(() => seed(merging));
    rerender(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={onMessage} />);

    const banner = screen.getByRole('region', { name: 'Merge in progress' });
    expect(banner).toHaveTextContent('Merging feature/x into main');
    expect(screen.getByTestId('merge-banner-count')).toHaveTextContent('2 files left to resolve');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith("Merge branch 'feature/x'");

    rerender(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={onMessage} />);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps Commit merge disabled while files conflict and says why', () => {
    seed(merging);
    render(<MergeBanner repoPath={REPO} commitMessage="Merge" onCommitMessageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Commit merge' })).toBeDisabled();
    expect(screen.getByTestId('merge-commit-reason')).toHaveTextContent('Resolve 2 files first');
  });

  it('commits the merge with the message once nothing conflicts', async () => {
    seed({ ...merging, conflicts: [] });
    const onMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <MergeBanner repoPath={REPO} commitMessage="Merge x" onCommitMessageChange={onMessage} />
    );

    expect(screen.getByTestId('merge-banner-count')).toHaveTextContent('All conflicts resolved');
    await user.click(screen.getByRole('button', { name: 'Commit merge' }));

    expect(concludeMerge).toHaveBeenCalledWith(REPO, 'Merge x');
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(''));
    expect(showToast).toHaveBeenCalledWith('Merged feature/x into main (deadbee).', 'success');
  });

  it('aborts only after a confirm that says other edits stay', async () => {
    seed(merging);
    const onMessage = vi.fn();
    const user = userEvent.setup();
    render(
      <MergeBanner
        repoPath={REPO}
        commitMessage={merging.message!}
        onCommitMessageChange={onMessage}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Abort merge' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Your other uncommitted edits stay.');
    expect(abortMerge).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Abort merge' }));
    expect(abortMerge).toHaveBeenCalledWith(REPO);
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(''));
  });

  it('opens the spawn dialog with a prompt naming every conflicted file', async () => {
    seed(merging);
    const user = userEvent.setup();
    render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Resolve all with an agent' }));

    const prompt = setInitialAgentTask.mock.calls[0][0] as string;
    expect(prompt).toContain('- src/a.ts');
    expect(prompt).toContain('- src/b.png');
    expect(prompt).toContain('Do not commit.');
    expect(setSpawnAgentRepoPath).toHaveBeenCalledWith(REPO);
    expect(setSpawnDialogOpen).toHaveBeenCalledWith(true);
  });

  it('opens a conflicted file in its merge tab', async () => {
    seed(merging);
    const user = userEvent.setup();
    render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

    const row = screen.getByRole('button', { name: /src\/a\.ts/ });
    expect(row).toHaveAccessibleName(/conflicted/);
    await user.click(row);

    const id = mergeTabId(REPO, 'src/a.ts');
    await waitFor(() => expect(useStore.getState().openTabs.map((t) => t.id)).toContain(id));
    expect(useStore.getState().openTabs.find((t) => t.id === id)?.name).toBe('a.ts (merge)');
  });

  describe('a rebase, cherry-pick or revert', () => {
    const rebasing: GitMergeState = {
      ...merging,
      operation: 'rebase',
      oursLabel: '4d8e3ed',
      theirsLabel: null,
      theirsOid: null,
      message: null,
      step: { current: 2, total: 5, subject: 'Add the parser', branch: 'feature/x' },
    };

    it('finishes in the panel: no commit box, its own buttons, and the progress line', () => {
      seed(rebasing);
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);
      expect(screen.getByText('A rebase is in progress')).toBeInTheDocument();
      expect(screen.getByTestId('operation-step')).toHaveTextContent(
        'Replaying commit 2 of 5: Add the parser'
      );
      expect(screen.queryByRole('button', { name: 'Commit merge' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Abort merge' })).not.toBeInTheDocument();
      expect(screen.queryByText(/terminal/)).not.toBeInTheDocument();

      expect(screen.getByRole('button', { name: 'Continue rebase' })).toBeDisabled();
      expect(screen.getByTestId('operation-continue-reason')).toHaveTextContent(
        'Resolve 2 files first'
      );
      expect(screen.getByRole('button', { name: 'Skip this commit' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Abort rebase' })).toBeEnabled();
    });

    it('continues once nothing conflicts and says when the rebase is done', async () => {
      seed({ ...rebasing, conflicts: [] });
      stepOperation.mockResolvedValueOnce({
        outcome: 'done',
        operation: 'rebase',
        conflicts: [],
        message: null,
      });
      const user = userEvent.setup();
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Continue rebase' }));

      expect(stepOperation).toHaveBeenCalledWith(REPO, 'continue');
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith('Rebase of feature/x finished.', 'success')
      );
    });

    it('opens the next conflict when the rebase stops on one', async () => {
      seed({ ...rebasing, conflicts: [] });
      stepOperation.mockResolvedValueOnce({
        outcome: 'conflicts',
        operation: 'rebase',
        conflicts: ['src/c.ts'],
        message: 'Stopped on the next commit: 1 file to resolve.',
      });
      const user = userEvent.setup();
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Continue rebase' }));

      await waitFor(() =>
        expect(useStore.getState().openTabs.map((t) => t.id)).toContain(
          mergeTabId(REPO, 'src/c.ts')
        )
      );
      expect(showToast).toHaveBeenCalledWith(
        'Stopped on the next commit: 1 file to resolve.',
        'info'
      );
    });

    it('shows why git stopped in a sentence, with its output folded away', async () => {
      seed({ ...rebasing, operation: 'cherry-pick', step: null, conflicts: [] });
      stepOperation.mockResolvedValueOnce({
        outcome: 'stopped',
        operation: 'cherry-pick',
        conflicts: [],
        message: 'This commit has no changes left after resolving. Skip it, or abort.',
        details: 'The previous cherry-pick is now empty\n    git commit --allow-empty',
      });
      const user = userEvent.setup();
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Continue cherry-pick' }));

      const note = await screen.findByTestId('operation-stop');
      expect(note).toHaveTextContent('This commit has no changes left');
      expect(within(note).getByText('What git said')).toBeInTheDocument();
      expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('allow-empty'), 'error');
    });

    it('aborts only after a confirm that says what comes back', async () => {
      seed(rebasing);
      const user = userEvent.setup();
      stepOperation.mockResolvedValueOnce({
        outcome: 'done',
        operation: 'rebase',
        conflicts: [],
        message: null,
      });
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Abort rebase' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('feature/x goes back to the commit it was on');
      expect(stepOperation).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Abort rebase' }));
      expect(stepOperation).toHaveBeenCalledWith(REPO, 'abort');
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith('Rebase of feature/x aborted.', 'info')
      );
    });

    it('skips only after a confirm', async () => {
      seed(rebasing);
      const user = userEvent.setup();
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Skip this commit' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(stepOperation).not.toHaveBeenCalled();
    });

    it('shows a refusal as an error toast', async () => {
      seed({ ...rebasing, conflicts: [] });
      stepOperation.mockRejectedValueOnce(new Error('git was not found on this machine'));
      const user = userEvent.setup();
      render(<MergeBanner repoPath={REPO} commitMessage="" onCommitMessageChange={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Continue rebase' }));
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith(
          'Could not continue the rebase: git was not found on this machine',
          'error'
        )
      );
    });
  });

  it('removes the agent worktree after the commit only when the human ticked it', async () => {
    const removeAgentWorktree = vi.fn(async () => undefined);
    useStore.setState({
      removeAgentWorktree,
      agentWorktrees: [
        {
          path: '/work/app.auric-wt/fix-1',
          name: 'fix-1',
          branch: 'auric/fix-1',
          sourceRepo: REPO,
          isAuric: true,
          dirty: false,
          branchAhead: true,
        },
      ],
    });
    seed({ ...merging, theirsLabel: 'auric/fix-1', conflicts: [] });
    const user = userEvent.setup();
    const { rerender } = render(
      <MergeBanner repoPath={REPO} commitMessage="Merge" onCommitMessageChange={vi.fn()} />
    );

    const box = screen.getByRole('checkbox', { name: /Remove the agent worktree/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Commit merge' }));

    await waitFor(() =>
      expect(removeAgentWorktree).toHaveBeenCalledWith('/work/app.auric-wt/fix-1', false)
    );

    // Without the tick nothing is removed.
    removeAgentWorktree.mockClear();
    concludeMerge.mockClear();
    rerender(<MergeBanner repoPath={REPO} commitMessage="Merge" onCommitMessageChange={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /Remove the agent worktree/ }));
    await user.click(screen.getByRole('button', { name: 'Commit merge' }));
    await waitFor(() => expect(concludeMerge).toHaveBeenCalled());
    expect(removeAgentWorktree).not.toHaveBeenCalled();
  });

  it('offers no worktree removal for an ordinary branch', () => {
    seed({ ...merging, conflicts: [] });
    render(<MergeBanner repoPath={REPO} commitMessage="Merge" onCommitMessageChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

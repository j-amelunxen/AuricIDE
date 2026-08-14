import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SourceControlPanel, type SourceControlProps } from './SourceControlPanel';

const defaultProps: SourceControlProps = {
  fileStatuses: [
    { path: 'README.md', status: 'modified', staged: null, unstaged: 'modified' },
    { path: 'new-file.md', status: 'added', staged: 'added', unstaged: null },
    { path: 'old-file.md', status: 'deleted', staged: null, unstaged: 'deleted' },
    { path: 'untracked-file.md', status: 'untracked', staged: null, unstaged: 'untracked' },
  ],
  commitMessage: '',
  isCommitting: false,
  agenticCommit: false,
  onCommitMessageChange: vi.fn(),
  onCommit: vi.fn(),
  onStageFile: vi.fn(),
  onUnstageFile: vi.fn(),
  onAgenticToggle: vi.fn(),
};

describe('SourceControlPanel – push', () => {
  it('pushes on click, independently of the commit message', async () => {
    // A push publishes what is already committed — it must not be gated on
    // the commit form.
    const user = userEvent.setup();
    const onPush = vi.fn();
    render(<SourceControlPanel {...defaultProps} onPush={onPush} />);

    await user.click(screen.getByRole('button', { name: 'Push' }));
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it('says it is pushing and refuses a second push meanwhile', () => {
    render(<SourceControlPanel {...defaultProps} onPush={vi.fn()} isPushing />);
    expect(screen.getByRole('button', { name: 'Pushing...' })).toBeDisabled();
  });

  it('offers no push when the caller cannot push', () => {
    render(<SourceControlPanel {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /push/i })).not.toBeInTheDocument();
  });
});

describe('SourceControlPanel', () => {
  it('renders the panel', () => {
    render(<SourceControlPanel {...defaultProps} />);
    expect(screen.getByTestId('source-control-panel')).toBeInTheDocument();
  });

  it('shows the commit message textarea', () => {
    render(<SourceControlPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('Commit message')).toBeInTheDocument();
  });

  it('renders file statuses with correct badges', () => {
    render(<SourceControlPanel {...defaultProps} />);
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('colors filenames by git status', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.getByText('README.md')).toHaveClass('text-git-modified');
    expect(screen.getByText('new-file.md')).toHaveClass('text-git-added');
    expect(screen.getByText('old-file.md')).toHaveClass('text-git-deleted');
  });

  it('calls onCommitMessageChange when typing', async () => {
    const user = userEvent.setup();
    const onCommitMessageChange = vi.fn();
    render(<SourceControlPanel {...defaultProps} onCommitMessageChange={onCommitMessageChange} />);

    await user.type(screen.getByPlaceholderText('Commit message'), 'fix bug');
    expect(onCommitMessageChange).toHaveBeenCalled();
  });

  it('calls onCommit when button is clicked', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SourceControlPanel {...defaultProps} commitMessage="fix bug" onCommit={onCommit} />);

    await user.click(screen.getByText('Commit'));
    expect(onCommit).toHaveBeenCalled();
  });

  it('disables commit button when message is empty', () => {
    render(<SourceControlPanel {...defaultProps} commitMessage="" />);
    expect(screen.getByText('Commit')).toBeDisabled();
  });

  it('disables commit button when committing', () => {
    render(<SourceControlPanel {...defaultProps} commitMessage="msg" isCommitting />);
    expect(screen.getByText('Committing...')).toBeDisabled();
  });

  it('shows empty state when no changes', () => {
    render(<SourceControlPanel {...defaultProps} fileStatuses={[]} />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('calls onFileClick with the unstaged side when a Changes row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('README.md'));
    expect(onFileClick).toHaveBeenCalledWith('README.md', 'unstaged');
  });

  it('calls onFileClick with the staged side when a Staged row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('new-file.md'));
    expect(onFileClick).toHaveBeenCalledWith('new-file.md', 'staged');
  });

  it('gives file rows role=button when onFileClick is provided', () => {
    render(<SourceControlPanel {...defaultProps} onFileClick={vi.fn()} />);

    expect(
      within(screen.getByTestId('changed-files')).getByRole('button', { name: /README\.md/ })
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('staged-files')).getByRole('button', { name: /new-file\.md/ })
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('changed-files')).getByRole('button', { name: /old-file\.md/ })
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('untracked-files')).getByRole('button', {
        name: /untracked-file\.md/,
      })
    ).toBeInTheDocument();
  });

  it('does not give file rows role=button when onFileClick is absent', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.queryByRole('button', { name: /README\.md/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new-file\.md/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit' })).toBeInTheDocument();
  });

  it('separates staged, changed, and untracked files into sections', () => {
    render(<SourceControlPanel {...defaultProps} />);

    const stagedSection = screen.getByTestId('staged-files');
    const changedSection = screen.getByTestId('changed-files');
    const untrackedSection = screen.getByTestId('untracked-files');

    expect(stagedSection).toHaveTextContent('new-file.md');
    expect(stagedSection).not.toHaveTextContent('README.md');

    expect(changedSection).toHaveTextContent('README.md');
    expect(changedSection).toHaveTextContent('old-file.md');
    expect(changedSection).not.toHaveTextContent('new-file.md');

    expect(untrackedSection).toHaveTextContent('Untracked');
    expect(untrackedSection).toHaveTextContent('untracked-file.md');
  });

  it('hides untracked section when there are no untracked files', () => {
    const trackedOnly = defaultProps.fileStatuses.filter((f) => f.status !== 'untracked');
    render(<SourceControlPanel {...defaultProps} fileStatuses={trackedOnly} />);

    expect(screen.queryByTestId('untracked-files')).not.toBeInTheDocument();
  });

  // --- Agentic Commit Tests ---

  it('renders the agentic checkbox', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit />);
    expect(screen.getByLabelText('Agentic')).toBeInTheDocument();
  });

  it('shows "Agentic Commit" button text when agentic is ON', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit />);
    expect(screen.getByText('Agentic Commit')).toBeInTheDocument();
  });

  it('shows a plain "Commit" button when agentic is OFF', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit={false} />);
    // The plain path is exactly a commit — the backend has no push, and a
    // button must not claim work it does not do.
    expect(screen.getByText('Commit')).toBeInTheDocument();
  });

  it('shows "Running Agent..." spinner text when agentic committing', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit isCommitting />);
    expect(screen.getByText('Running Agent...')).toBeInTheDocument();
  });

  it('shows "Committing..." spinner text when normal committing', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        agenticCommit={false}
        commitMessage="msg"
        isCommitting
      />
    );
    expect(screen.getByText('Committing...')).toBeInTheDocument();
  });

  it('does not require commit message when agentic is ON', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit commitMessage="" />);
    expect(screen.getByText('Agentic Commit')).not.toBeDisabled();
  });

  it('still disables button when committing even with agentic ON', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit isCommitting />);
    expect(screen.getByText('Running Agent...')).toBeDisabled();
  });

  it('calls onAgenticToggle when checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onAgenticToggle = vi.fn();
    render(
      <SourceControlPanel
        {...defaultProps}
        agenticCommit={false}
        onAgenticToggle={onAgenticToggle}
      />
    );

    await user.click(screen.getByLabelText('Agentic'));
    expect(onAgenticToggle).toHaveBeenCalledWith(true);
  });

  // --- Ticket Badge Tests ---

  it('shows ticket badge when ticketPrefix is provided', () => {
    render(<SourceControlPanel {...defaultProps} ticketPrefix="AB-1234" />);
    const badge = screen.getByTestId('ticket-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('AB-1234');
  });

  it('hides ticket badge when ticketPrefix is not provided', () => {
    render(<SourceControlPanel {...defaultProps} />);
    expect(screen.queryByTestId('ticket-badge')).not.toBeInTheDocument();
  });

  it('hides ticket badge when ticketPrefix is empty string', () => {
    render(<SourceControlPanel {...defaultProps} ticketPrefix="" />);
    expect(screen.queryByTestId('ticket-badge')).not.toBeInTheDocument();
  });

  // --- Refresh Button ---

  it('calls onRefresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<SourceControlPanel {...defaultProps} onRefresh={onRefresh} />);

    const refreshBtn = screen.getByTitle('Refresh');
    await user.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalled();
  });

  // --- Discard Changes ---

  it('shows Discard Changes menu on right-click when onDiscardFile is provided', () => {
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Discard Changes')).toBeInTheDocument();
  });

  it('does not show context menu on right-click when onDiscardFile is absent', () => {
    render(<SourceControlPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('asks before discarding and touches nothing while the question stands', async () => {
    // Discarding is the one action in the panel git cannot undo. The menu item
    // sits under the cursor right after a right-click, so the click that opens
    // the menu must not be able to destroy anything on its own.
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    await user.click(screen.getByText('Discard Changes'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onDiscardFile).not.toHaveBeenCalled();
  });

  it('discards the file once the question is confirmed', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    await user.click(screen.getByText('Discard Changes'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onDiscardFile).toHaveBeenCalledWith('README.md');
  });

  it('keeps the file when the question is declined', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    await user.click(screen.getByText('Discard Changes'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onDiscardFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says a tracked file loses its uncommitted changes', async () => {
    const user = userEvent.setup();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    await user.click(screen.getByText('Discard Changes'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('README.md');
    expect(dialog).toHaveTextContent(/uncommitted changes/i);
    expect(dialog).toHaveTextContent(/last commit/i);
  });

  it('says an untracked file is deleted from disk, because git has no copy', async () => {
    // For a file git has never seen there is nothing to restore from — the
    // wording for a modified file would understate this by a lot.
    const user = userEvent.setup();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText('untracked-file.md'));
    await user.click(screen.getByText('Discard Changes'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('untracked-file.md');
    expect(dialog).toHaveTextContent(/delete/i);
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('warns about deletion for a newly added file too — discard removes it as well', async () => {
    // Staged-new goes down the same path in the backend: reset, then remove the
    // file. Nothing was ever committed, so there is no copy behind it either.
    const user = userEvent.setup();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText('new-file.md'));
    await user.click(screen.getByText('Discard Changes'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/delete/i);
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes context menu after Discard Changes is clicked', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByText('Discard Changes'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes context menu when clicking outside', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('SourceControlPanel – staged / changes / untracked', () => {
  const bothSides = {
    path: 'src/a.ts',
    status: 'modified' as const,
    staged: 'modified' as const,
    unstaged: 'modified' as const,
  };

  it('renders Staged, Changes, and Untracked headings', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.getByTestId('staged-files')).toHaveTextContent(/staged/i);
    expect(screen.getByTestId('changed-files')).toHaveTextContent(/changes/i);
    expect(screen.getByTestId('untracked-files')).toHaveTextContent(/untracked/i);
  });

  it('puts a both-sides file in Staged and Changes', () => {
    render(<SourceControlPanel {...defaultProps} fileStatuses={[bothSides]} />);

    expect(within(screen.getByTestId('staged-files')).getByText('src/a.ts')).toBeInTheDocument();
    expect(within(screen.getByTestId('changed-files')).getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.queryByTestId('untracked-files')).not.toBeInTheDocument();
  });

  it('calls onUnstageFile from − and does not fire onFileClick', async () => {
    const user = userEvent.setup();
    const onUnstageFile = vi.fn();
    const onFileClick = vi.fn();
    render(
      <SourceControlPanel
        {...defaultProps}
        onUnstageFile={onUnstageFile}
        onFileClick={onFileClick}
      />
    );

    await user.click(screen.getByTestId('unstage-new-file.md'));
    expect(onUnstageFile).toHaveBeenCalledWith('new-file.md');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('calls onStageFile from + on Changes and does not fire onFileClick', async () => {
    const user = userEvent.setup();
    const onStageFile = vi.fn();
    const onFileClick = vi.fn();
    render(
      <SourceControlPanel {...defaultProps} onStageFile={onStageFile} onFileClick={onFileClick} />
    );

    await user.click(screen.getByTestId('stage-README.md'));
    expect(onStageFile).toHaveBeenCalledWith('README.md');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('calls onStageFile from + on Untracked and does not fire onFileClick', async () => {
    const user = userEvent.setup();
    const onStageFile = vi.fn();
    const onFileClick = vi.fn();
    render(
      <SourceControlPanel {...defaultProps} onStageFile={onStageFile} onFileClick={onFileClick} />
    );

    await user.click(screen.getByTestId('stage-untracked-file.md'));
    expect(onStageFile).toHaveBeenCalledWith('untracked-file.md');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('passes unstaged when an Untracked row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('untracked-file.md'));
    expect(onFileClick).toHaveBeenCalledWith('untracked-file.md', 'unstaged');
  });

  it('fires Unstage All and Stage All from the section headers', async () => {
    const user = userEvent.setup();
    const onStageAll = vi.fn();
    const onUnstageAll = vi.fn();
    render(
      <SourceControlPanel {...defaultProps} onStageAll={onStageAll} onUnstageAll={onUnstageAll} />
    );

    await user.click(screen.getByRole('button', { name: 'Unstage All' }));
    expect(onUnstageAll).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Stage All' }));
    expect(onStageAll).toHaveBeenCalledTimes(1);
  });

  it('omits the empty Staged section', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        fileStatuses={[
          { path: 'README.md', status: 'modified', staged: null, unstaged: 'modified' },
        ]}
      />
    );

    expect(screen.queryByTestId('staged-files')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unstage All' })).not.toBeInTheDocument();
    expect(screen.getByTestId('changed-files')).toBeInTheDocument();
  });

  it('does not render ignored files even when the caller passes them', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        fileStatuses={[
          { path: 'dist/out.js', status: 'ignored', staged: null, unstaged: null },
          { path: 'README.md', status: 'modified', staged: null, unstaged: 'modified' },
        ]}
      />
    );

    expect(screen.queryByText('dist/out.js')).not.toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('shows No changes when every file is ignored', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        fileStatuses={[{ path: 'dist/out.js', status: 'ignored', staged: null, unstaged: null }]}
      />
    );

    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(screen.queryByTestId('staged-files')).not.toBeInTheDocument();
    expect(screen.queryByTestId('changed-files')).not.toBeInTheDocument();
  });

  it('keeps discard off a Staged row that also lives in Changes', () => {
    render(
      <SourceControlPanel {...defaultProps} fileStatuses={[bothSides]} onDiscardFile={vi.fn()} />
    );

    fireEvent.contextMenu(within(screen.getByTestId('staged-files')).getByText('src/a.ts'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(within(screen.getByTestId('changed-files')).getByText('src/a.ts'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('SourceControlPanel – view tabs', () => {
  it('renders Changes, History and Compare tabs', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.getByTestId('scm-view-changes')).toHaveTextContent('Changes');
    expect(screen.getByTestId('scm-view-history')).toHaveTextContent('History');
    expect(screen.getByTestId('scm-view-compare')).toHaveTextContent('Compare');
  });

  it('keeps Staged / Changes / Untracked on the Changes view', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.getByTestId('staged-files')).toHaveTextContent(/staged/i);
    expect(screen.getByTestId('changed-files')).toHaveTextContent(/changes/i);
    expect(screen.getByTestId('untracked-files')).toHaveTextContent(/untracked/i);
    expect(screen.getByPlaceholderText('Commit message')).toBeInTheDocument();
  });

  it('switches to History and hides the commit form', async () => {
    const user = userEvent.setup();
    const onScmViewChange = vi.fn();
    const { rerender } = render(
      <SourceControlPanel {...defaultProps} scmView="changes" onScmViewChange={onScmViewChange} />
    );

    await user.click(screen.getByTestId('scm-view-history'));
    expect(onScmViewChange).toHaveBeenCalledWith('history');

    rerender(
      <SourceControlPanel
        {...defaultProps}
        scmView="history"
        historyPath="src/a.ts"
        historyCommits={[
          {
            oid: 'abc123def456',
            summary: 'fix the thing',
            author: 'Ada',
            timestamp: '2026-08-14 10:00:00',
            touched: ['src/a.ts'],
          },
        ]}
        onScmViewChange={onScmViewChange}
      />
    );

    expect(screen.getByTestId('git-history-list')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Commit message')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staged-files')).not.toBeInTheDocument();
  });

  it('switches to Compare and shows the branch select', async () => {
    const user = userEvent.setup();
    const onScmViewChange = vi.fn();
    const { rerender } = render(
      <SourceControlPanel {...defaultProps} scmView="changes" onScmViewChange={onScmViewChange} />
    );

    await user.click(screen.getByTestId('scm-view-compare'));
    expect(onScmViewChange).toHaveBeenCalledWith('compare');

    rerender(
      <SourceControlPanel
        {...defaultProps}
        scmView="compare"
        branches={[{ name: 'main', kind: 'local', isCurrent: true }]}
        onScmViewChange={onScmViewChange}
      />
    );

    expect(screen.getByTestId('compare-ref-select')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Commit message')).not.toBeInTheDocument();
  });
});

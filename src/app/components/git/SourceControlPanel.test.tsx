import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SourceControlPanel, type RepoView, type SourceControlProps } from './SourceControlPanel';
import type { GitFileStatus } from '@/lib/tauri/git';

const ROOT_PATH = '/workspace';
const OTHER_PATH = '/workspace/api';

const rootFileStatuses: GitFileStatus[] = [
  { path: 'README.md', status: 'modified', staged: null, unstaged: 'modified' },
  { path: 'new-file.md', status: 'added', staged: 'added', unstaged: null },
  { path: 'old-file.md', status: 'deleted', staged: null, unstaged: 'deleted' },
  { path: 'untracked-file.md', status: 'untracked', staged: null, unstaged: 'untracked' },
];

/** Adapts the pre-multi-repo test fixtures into a single root RepoView. */
function singleRootRepo(overrides: Partial<RepoView> = {}): RepoView {
  return {
    repoPath: ROOT_PATH,
    label: 'workspace',
    kind: 'root',
    branchName: 'main',
    fileStatuses: rootFileStatuses,
    commitMessage: '',
    isCommitting: false,
    isPushing: false,
    ...overrides,
  };
}

function otherRepo(overrides: Partial<RepoView> = {}): RepoView {
  return {
    repoPath: OTHER_PATH,
    label: 'api',
    kind: 'nested',
    branchName: 'feature/api',
    fileStatuses: [{ path: 'src/lib.rs', status: 'modified', staged: null, unstaged: 'modified' }],
    commitMessage: '',
    isCommitting: false,
    isPushing: false,
    ...overrides,
  };
}

const defaultProps: SourceControlProps = {
  repos: [singleRootRepo()],
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
    expect(onPush).toHaveBeenCalledWith(ROOT_PATH);
  });

  it('says it is pushing and refuses a second push meanwhile', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[singleRootRepo({ isPushing: true })]}
        onPush={vi.fn()}
      />
    );
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

  it('calls onCommitMessageChange with the repo path when typing', async () => {
    const user = userEvent.setup();
    const onCommitMessageChange = vi.fn();
    render(<SourceControlPanel {...defaultProps} onCommitMessageChange={onCommitMessageChange} />);

    await user.type(screen.getByPlaceholderText('Commit message'), 'f');
    expect(onCommitMessageChange).toHaveBeenCalledWith(ROOT_PATH, 'f');
  });

  it('calls onCommit with the repo path when the button is clicked', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[singleRootRepo({ commitMessage: 'fix bug' })]}
        onCommit={onCommit}
      />
    );

    await user.click(screen.getByText('Commit'));
    expect(onCommit).toHaveBeenCalledWith(ROOT_PATH);
  });

  it('disables commit button when message is empty', () => {
    render(
      <SourceControlPanel {...defaultProps} repos={[singleRootRepo({ commitMessage: '' })]} />
    );
    expect(screen.getByText('Commit')).toBeDisabled();
  });

  it('disables commit button when committing', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[singleRootRepo({ commitMessage: 'msg', isCommitting: true })]}
      />
    );
    expect(screen.getByText('Committing...')).toBeDisabled();
  });

  it('shows empty state when no changes', () => {
    render(<SourceControlPanel {...defaultProps} repos={[singleRootRepo({ fileStatuses: [] })]} />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('calls onFileClick with repo path and the unstaged side when a Changes row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('README.md'));
    expect(onFileClick).toHaveBeenCalledWith(ROOT_PATH, 'README.md', 'unstaged');
  });

  it('calls onFileClick with repo path and the staged side when a Staged row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('new-file.md'));
    expect(onFileClick).toHaveBeenCalledWith(ROOT_PATH, 'new-file.md', 'staged');
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
    const trackedOnly = rootFileStatuses.filter((f) => f.status !== 'untracked');
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[singleRootRepo({ fileStatuses: trackedOnly })]}
      />
    );

    expect(screen.queryByTestId('untracked-files')).not.toBeInTheDocument();
  });

  // --- Agentic Commit Tests ---

  it('renders the agentic checkbox', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit />);
    expect(screen.getByLabelText('Agentic')).toBeInTheDocument();
  });

  it('offers Commit and Commit & Push as two clicks when agentic is ON', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit onPush={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Commit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit & Push' })).toBeInTheDocument();
    // Already-committed work still has a cheap publish of its own.
    expect(screen.getByRole('button', { name: 'Push' })).toBeInTheDocument();
  });

  it('shows a plain "Commit" button when agentic is OFF', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit={false} />);
    // The plain path is exactly a commit — the backend has no push, and a
    // button must not claim work it does not do.
    expect(screen.getByText('Commit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit & Push' })).not.toBeInTheDocument();
  });

  it('calls onCommit without push when the agentic Commit button is clicked', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SourceControlPanel {...defaultProps} agenticCommit onCommit={onCommit} />);

    await user.click(screen.getByRole('button', { name: 'Commit' }));
    expect(onCommit).toHaveBeenCalledWith(ROOT_PATH);
    expect(onCommit).not.toHaveBeenCalledWith(ROOT_PATH, expect.anything());
  });

  it('calls onCommit with push when Commit & Push is clicked', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SourceControlPanel {...defaultProps} agenticCommit onCommit={onCommit} />);

    await user.click(screen.getByRole('button', { name: 'Commit & Push' }));
    expect(onCommit).toHaveBeenCalledWith(ROOT_PATH, { push: true });
  });

  it('shows "Running Agent..." spinner text when agentic committing', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        agenticCommit
        repos={[singleRootRepo({ isCommitting: true })]}
      />
    );
    expect(screen.getByText('Running Agent...')).toBeInTheDocument();
  });

  it('shows "Committing..." spinner text when normal committing', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        agenticCommit={false}
        repos={[singleRootRepo({ commitMessage: 'msg', isCommitting: true })]}
      />
    );
    expect(screen.getByText('Committing...')).toBeInTheDocument();
  });

  it('does not require commit message when agentic is ON', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        agenticCommit
        repos={[singleRootRepo({ commitMessage: '' })]}
      />
    );
    expect(screen.getByRole('button', { name: 'Commit' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Commit & Push' })).not.toBeDisabled();
  });

  it('still disables button when committing even with agentic ON', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        agenticCommit
        repos={[singleRootRepo({ isCommitting: true })]}
      />
    );
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
    render(
      <SourceControlPanel {...defaultProps} repos={[singleRootRepo({ ticketPrefix: 'AB-1234' })]} />
    );
    const badge = screen.getByTestId('ticket-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('AB-1234');
  });

  it('hides ticket badge when ticketPrefix is not provided', () => {
    render(<SourceControlPanel {...defaultProps} />);
    expect(screen.queryByTestId('ticket-badge')).not.toBeInTheDocument();
  });

  it('hides ticket badge when ticketPrefix is empty string', () => {
    render(<SourceControlPanel {...defaultProps} repos={[singleRootRepo({ ticketPrefix: '' })]} />);
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

  it('discards the file with the repo path once the question is confirmed', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    await user.click(screen.getByText('Discard Changes'));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(onDiscardFile).toHaveBeenCalledWith(ROOT_PATH, 'README.md');
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
  const bothSides: GitFileStatus = {
    path: 'src/a.ts',
    status: 'modified',
    staged: 'modified',
    unstaged: 'modified',
  };

  it('renders Staged, Changes, and Untracked headings', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.getByTestId('staged-files')).toHaveTextContent(/staged/i);
    expect(screen.getByTestId('changed-files')).toHaveTextContent(/changes/i);
    expect(screen.getByTestId('untracked-files')).toHaveTextContent(/untracked/i);
  });

  it('puts a both-sides file in Staged and Changes', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[singleRootRepo({ fileStatuses: [bothSides] })]}
      />
    );

    expect(within(screen.getByTestId('staged-files')).getByText('src/a.ts')).toBeInTheDocument();
    expect(within(screen.getByTestId('changed-files')).getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.queryByTestId('untracked-files')).not.toBeInTheDocument();
  });

  it('calls onUnstageFile with the repo path from − and does not fire onFileClick', async () => {
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
    expect(onUnstageFile).toHaveBeenCalledWith(ROOT_PATH, 'new-file.md');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('calls onStageFile with the repo path from + on Changes and does not fire onFileClick', async () => {
    const user = userEvent.setup();
    const onStageFile = vi.fn();
    const onFileClick = vi.fn();
    render(
      <SourceControlPanel {...defaultProps} onStageFile={onStageFile} onFileClick={onFileClick} />
    );

    await user.click(screen.getByTestId('stage-README.md'));
    expect(onStageFile).toHaveBeenCalledWith(ROOT_PATH, 'README.md');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('calls onStageFile with the repo path from + on Untracked and does not fire onFileClick', async () => {
    const user = userEvent.setup();
    const onStageFile = vi.fn();
    const onFileClick = vi.fn();
    render(
      <SourceControlPanel {...defaultProps} onStageFile={onStageFile} onFileClick={onFileClick} />
    );

    await user.click(screen.getByTestId('stage-untracked-file.md'));
    expect(onStageFile).toHaveBeenCalledWith(ROOT_PATH, 'untracked-file.md');
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it('passes unstaged when an Untracked row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('untracked-file.md'));
    expect(onFileClick).toHaveBeenCalledWith(ROOT_PATH, 'untracked-file.md', 'unstaged');
  });

  it('fires Unstage All and Stage All with the repo path from the section headers', async () => {
    const user = userEvent.setup();
    const onStageAll = vi.fn();
    const onUnstageAll = vi.fn();
    render(
      <SourceControlPanel {...defaultProps} onStageAll={onStageAll} onUnstageAll={onUnstageAll} />
    );

    await user.click(screen.getByRole('button', { name: 'Unstage All' }));
    expect(onUnstageAll).toHaveBeenCalledWith(ROOT_PATH);

    await user.click(screen.getByRole('button', { name: 'Stage All' }));
    expect(onStageAll).toHaveBeenCalledWith(ROOT_PATH);
  });

  it('omits the empty Staged section', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[
          singleRootRepo({
            fileStatuses: [
              { path: 'README.md', status: 'modified', staged: null, unstaged: 'modified' },
            ],
          }),
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
        repos={[
          singleRootRepo({
            fileStatuses: [
              { path: 'dist/out.js', status: 'ignored', staged: null, unstaged: null },
              { path: 'README.md', status: 'modified', staged: null, unstaged: 'modified' },
            ],
          }),
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
        repos={[
          singleRootRepo({
            fileStatuses: [
              { path: 'dist/out.js', status: 'ignored', staged: null, unstaged: null },
            ],
          }),
        ]}
      />
    );

    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(screen.queryByTestId('staged-files')).not.toBeInTheDocument();
    expect(screen.queryByTestId('changed-files')).not.toBeInTheDocument();
  });

  it('keeps discard off a Staged row that also lives in Changes', () => {
    render(
      <SourceControlPanel
        {...defaultProps}
        repos={[singleRootRepo({ fileStatuses: [bothSides] })]}
        onDiscardFile={vi.fn()}
      />
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

  it('does not show the repo picker on History/Compare with a single repo', () => {
    const { rerender } = render(<SourceControlPanel {...defaultProps} scmView="history" />);
    expect(screen.queryByTestId('scm-repo-picker')).not.toBeInTheDocument();

    rerender(<SourceControlPanel {...defaultProps} scmView="compare" />);
    expect(screen.queryByTestId('scm-repo-picker')).not.toBeInTheDocument();
  });
});

describe('SourceControlPanel – single root repo (invariant 3)', () => {
  it('renders no repo header or picker for one root repo', () => {
    render(<SourceControlPanel {...defaultProps} />);

    expect(screen.queryByTestId(`repo-section-${ROOT_PATH}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('scm-repo-picker')).not.toBeInTheDocument();
  });
});

describe('SourceControlPanel – multi-repo', () => {
  const multiRepoProps: SourceControlProps = {
    ...defaultProps,
    repos: [singleRootRepo(), otherRepo()],
  };

  it('renders one collapsible section per repo, each with its own count and commit box', () => {
    render(<SourceControlPanel {...multiRepoProps} />);

    const rootSection = screen.getByTestId(`repo-section-${ROOT_PATH}`);
    const apiSection = screen.getByTestId(`repo-section-${OTHER_PATH}`);
    expect(rootSection).toHaveTextContent('workspace');
    expect(rootSection).toHaveTextContent('4');
    expect(apiSection).toHaveTextContent('api');
    expect(apiSection).toHaveTextContent('1');

    // Root has changes so it starts expanded — its commit box is visible.
    expect(within(rootSection).getByPlaceholderText('Commit message')).toBeInTheDocument();
  });

  it('shows the branch name in each repo header', () => {
    render(<SourceControlPanel {...multiRepoProps} />);

    expect(screen.getByTestId(`repo-section-${ROOT_PATH}`)).toHaveTextContent('main');
    expect(screen.getByTestId(`repo-section-${OTHER_PATH}`)).toHaveTextContent('feature/api');
  });

  it('gives the repo header button a visible focus ring', () => {
    render(<SourceControlPanel {...multiRepoProps} />);

    const header = within(screen.getByTestId(`repo-section-${ROOT_PATH}`)).getByRole('button', {
      name: /workspace/,
    });
    expect(header.className).toContain('focus-visible:outline-2');
    expect(header.className).toContain('focus-visible:outline-primary');
  });

  it('lets the repo label win space over a long branch name', () => {
    const longBranch = otherRepo({ branchName: 'feature/services/payment-gateway-refactor' });
    render(<SourceControlPanel {...defaultProps} repos={[singleRootRepo(), longBranch]} />);

    const apiSection = screen.getByTestId(`repo-section-${OTHER_PATH}`);
    const label = within(apiSection).getByText('api');
    const branch = within(apiSection).getByText('feature/services/payment-gateway-refactor');

    expect(label.className).toContain('flex-1');
    expect(label.className).toContain('truncate');
    expect(branch.className).toContain('max-w-[40%]');
    expect(branch.className).toContain('truncate');
  });

  it('labels the bare change count for screen readers', () => {
    render(<SourceControlPanel {...multiRepoProps} />);

    expect(
      within(screen.getByTestId(`repo-section-${ROOT_PATH}`)).getByLabelText('4 changed files')
    ).toHaveTextContent('4');
    expect(
      within(screen.getByTestId(`repo-section-${OTHER_PATH}`)).getByLabelText('1 changed file')
    ).toHaveTextContent('1');
  });

  it('marks a submodule with a chip and leaves nested/root unmarked', () => {
    const submodule = otherRepo({
      repoPath: '/workspace/vendor',
      label: 'vendor',
      kind: 'submodule',
    });
    render(<SourceControlPanel {...defaultProps} repos={[singleRootRepo(), submodule]} />);

    const submoduleSection = screen.getByTestId('repo-section-/workspace/vendor');
    expect(within(submoduleSection).getByText('Submodule')).toBeInTheDocument();

    const rootSection = screen.getByTestId(`repo-section-${ROOT_PATH}`);
    expect(within(rootSection).queryByText('Submodule')).not.toBeInTheDocument();
  });

  it('calls onStageFile with the clicked repo path, not the other repo', async () => {
    const user = userEvent.setup();
    const onStageFile = vi.fn();
    render(<SourceControlPanel {...multiRepoProps} onStageFile={onStageFile} />);

    // Both sections start expanded here since both repos have changes.
    await user.click(screen.getByTestId('stage-src/lib.rs'));
    expect(onStageFile).toHaveBeenCalledWith(OTHER_PATH, 'src/lib.rs');
  });

  it('changes the commit message of one repo without touching the other', async () => {
    const user = userEvent.setup();
    const onCommitMessageChange = vi.fn();
    render(
      <SourceControlPanel {...multiRepoProps} onCommitMessageChange={onCommitMessageChange} />
    );

    const apiSection = screen.getByTestId(`repo-section-${OTHER_PATH}`);
    await user.type(within(apiSection).getByPlaceholderText('Commit message'), 'x');

    expect(onCommitMessageChange).toHaveBeenCalledWith(OTHER_PATH, 'x');
    expect(onCommitMessageChange).not.toHaveBeenCalledWith(ROOT_PATH, expect.anything());
  });

  it('starts a repo with no changes collapsed and expands it on header click', async () => {
    const user = userEvent.setup();
    const quiet = otherRepo({ fileStatuses: [] });
    render(<SourceControlPanel {...defaultProps} repos={[singleRootRepo(), quiet]} />);

    const quietSection = screen.getByTestId(`repo-section-${OTHER_PATH}`);
    const header = within(quietSection).getByRole('button', { name: /api/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(within(quietSection).queryByText('No changes')).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(within(quietSection).getByText('No changes')).toBeInTheDocument();
  });

  it('starts a repo with changes expanded', () => {
    render(<SourceControlPanel {...multiRepoProps} />);

    const header = within(screen.getByTestId(`repo-section-${ROOT_PATH}`)).getByRole('button', {
      name: /workspace/,
    });
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('follows late-arriving statuses instead of freezing at the mount-time count', () => {
    // In the app, repos are set before their per-repo statuses land — a
    // section must not get stuck collapsed just because it mounted empty.
    const empty = otherRepo({ fileStatuses: [] });
    const { rerender } = render(
      <SourceControlPanel {...defaultProps} repos={[singleRootRepo(), empty]} />
    );

    const apiHeader = within(screen.getByTestId(`repo-section-${OTHER_PATH}`)).getByRole('button', {
      name: /api/,
    });
    expect(apiHeader).toHaveAttribute('aria-expanded', 'false');

    rerender(<SourceControlPanel {...defaultProps} repos={[singleRootRepo(), otherRepo()]} />);

    const apiSection = screen.getByTestId(`repo-section-${OTHER_PATH}`);
    expect(within(apiSection).getByRole('button', { name: /api/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(within(apiSection).getByText('src/lib.rs')).toBeInTheDocument();
  });

  it('keeps a user-collapsed section collapsed even as more changes arrive', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SourceControlPanel {...multiRepoProps} />);

    const rootSection = screen.getByTestId(`repo-section-${ROOT_PATH}`);
    const rootHeader = within(rootSection).getByRole('button', { name: /workspace/ });
    expect(rootHeader).toHaveAttribute('aria-expanded', 'true');

    await user.click(rootHeader);
    expect(rootHeader).toHaveAttribute('aria-expanded', 'false');

    const moreChanges = singleRootRepo({
      fileStatuses: [
        ...rootFileStatuses,
        { path: 'extra.md', status: 'modified', staged: null, unstaged: 'modified' },
      ],
    });
    rerender(<SourceControlPanel {...defaultProps} repos={[moreChanges, otherRepo()]} />);

    expect(
      within(screen.getByTestId(`repo-section-${ROOT_PATH}`)).getByRole('button', {
        name: /workspace/,
      })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the agentic toggle once, above the repo sections', () => {
    render(<SourceControlPanel {...multiRepoProps} agenticCommit />);

    expect(screen.getAllByLabelText('Agentic')).toHaveLength(1);
    // It is not inside either repo section.
    expect(
      within(screen.getByTestId(`repo-section-${ROOT_PATH}`)).queryByLabelText('Agentic')
    ).not.toBeInTheDocument();
  });

  it('commits-and-pushes only the clicked repo when agentic is on', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<SourceControlPanel {...multiRepoProps} agenticCommit onCommit={onCommit} />);

    const apiSection = screen.getByTestId(`repo-section-${OTHER_PATH}`);
    await user.click(within(apiSection).getByRole('button', { name: 'Commit & Push' }));

    expect(onCommit).toHaveBeenCalledWith(OTHER_PATH, { push: true });
    expect(onCommit).not.toHaveBeenCalledWith(ROOT_PATH, expect.anything());
  });

  it('shows the empty state with no repos, and Refresh stays available', () => {
    const onRefresh = vi.fn();
    render(<SourceControlPanel {...defaultProps} repos={[]} onRefresh={onRefresh} />);

    expect(
      screen.getByText('No git repository found in this folder or up to 4 levels below it.')
    ).toBeInTheDocument();
    expect(screen.getByTitle('Refresh')).toBeInTheDocument();
    expect(screen.queryByTestId(/^repo-section-/)).not.toBeInTheDocument();
  });

  it('shows the repo picker on History/Compare only when there is more than one repo, and reports the choice', async () => {
    const user = userEvent.setup();
    const onActiveRepoChange = vi.fn();
    const { rerender } = render(
      <SourceControlPanel
        {...multiRepoProps}
        scmView="history"
        activeRepoPath={ROOT_PATH}
        onActiveRepoChange={onActiveRepoChange}
      />
    );

    const picker = screen.getByTestId('scm-repo-picker');
    expect(picker).toHaveValue(ROOT_PATH);
    await user.selectOptions(picker, OTHER_PATH);
    expect(onActiveRepoChange).toHaveBeenCalledWith(OTHER_PATH);

    rerender(
      <SourceControlPanel
        {...multiRepoProps}
        scmView="compare"
        activeRepoPath={ROOT_PATH}
        onActiveRepoChange={onActiveRepoChange}
      />
    );
    expect(screen.getByTestId('scm-repo-picker')).toBeInTheDocument();
  });

  it('offers Ignore on a nested repo and never on the project root', async () => {
    const user = userEvent.setup();
    const onIgnoreRepo = vi.fn();
    render(<SourceControlPanel {...multiRepoProps} onIgnoreRepo={onIgnoreRepo} />);

    expect(screen.queryByTestId(`ignore-repo-${ROOT_PATH}`)).not.toBeInTheDocument();
    const ignore = screen.getByTestId(`ignore-repo-${OTHER_PATH}`);
    expect(ignore).toHaveTextContent('Ignore');
    await user.click(ignore);
    expect(onIgnoreRepo).toHaveBeenCalledWith(OTHER_PATH);
  });

  it('hides Ignore when the caller cannot ignore a repo', () => {
    render(<SourceControlPanel {...multiRepoProps} />);

    expect(screen.queryByLabelText('Ignore this repository')).not.toBeInTheDocument();
  });
});

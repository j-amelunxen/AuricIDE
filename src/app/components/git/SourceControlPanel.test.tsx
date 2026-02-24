import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SourceControlPanel, type SourceControlProps } from './SourceControlPanel';

const defaultProps: SourceControlProps = {
  fileStatuses: [
    { path: 'README.md', status: 'modified' },
    { path: 'new-file.md', status: 'added' },
    { path: 'old-file.md', status: 'deleted' },
    { path: 'untracked-file.md', status: 'untracked' },
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

    await user.click(screen.getByText('Commit & Push'));
    expect(onCommit).toHaveBeenCalled();
  });

  it('disables commit button when message is empty', () => {
    render(<SourceControlPanel {...defaultProps} commitMessage="" />);
    expect(screen.getByText('Commit & Push')).toBeDisabled();
  });

  it('disables commit button when committing', () => {
    render(<SourceControlPanel {...defaultProps} commitMessage="msg" isCommitting />);
    expect(screen.getByText('Committing...')).toBeDisabled();
  });

  it('shows empty state when no changes', () => {
    render(<SourceControlPanel {...defaultProps} fileStatuses={[]} />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('calls onFileClick when a file row is clicked', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    await user.click(screen.getByText('README.md'));
    expect(onFileClick).toHaveBeenCalledWith('README.md');
  });

  it('gives file rows role=button when onFileClick is provided', () => {
    const onFileClick = vi.fn();
    render(<SourceControlPanel {...defaultProps} onFileClick={onFileClick} />);

    const buttons = screen.getAllByRole('button');
    // commit button + 4 file rows
    expect(buttons.length).toBe(5);
  });

  it('does not give file rows role=button when onFileClick is absent', () => {
    render(<SourceControlPanel {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    // only commit button
    expect(buttons.length).toBe(1);
  });

  it('separates tracked and untracked files into sections', () => {
    render(<SourceControlPanel {...defaultProps} />);

    const trackedSection = screen.getByTestId('tracked-files');
    const untrackedSection = screen.getByTestId('untracked-files');

    expect(trackedSection).toHaveTextContent('README.md');
    expect(trackedSection).toHaveTextContent('new-file.md');
    expect(trackedSection).toHaveTextContent('old-file.md');

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

  it('shows "Commit & Push" button text when agentic is OFF', () => {
    render(<SourceControlPanel {...defaultProps} agenticCommit={false} />);
    expect(screen.getByText('Commit & Push')).toBeInTheDocument();
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
    expect(screen.getByTestId('discard-context-menu')).toBeInTheDocument();
    expect(screen.getByText('Discard Changes')).toBeInTheDocument();
  });

  it('does not show context menu on right-click when onDiscardFile is absent', () => {
    render(<SourceControlPanel {...defaultProps} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.queryByTestId('discard-context-menu')).not.toBeInTheDocument();
  });

  it('calls onDiscardFile with the file path when Discard Changes is clicked', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    await user.click(screen.getByText('Discard Changes'));
    expect(onDiscardFile).toHaveBeenCalledWith('README.md');
  });

  it('closes context menu after Discard Changes is clicked', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.getByTestId('discard-context-menu')).toBeInTheDocument();
    await user.click(screen.getByText('Discard Changes'));
    expect(screen.queryByTestId('discard-context-menu')).not.toBeInTheDocument();
  });

  it('closes context menu when clicking outside', async () => {
    const user = userEvent.setup();
    const onDiscardFile = vi.fn();
    render(<SourceControlPanel {...defaultProps} onDiscardFile={onDiscardFile} />);

    fireEvent.contextMenu(screen.getByText('README.md'));
    expect(screen.getByTestId('discard-context-menu')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByTestId('discard-context-menu')).not.toBeInTheDocument();
  });
});

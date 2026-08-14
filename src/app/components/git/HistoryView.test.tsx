import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HistoryView } from './HistoryView';
import type { CommitInfo } from '@/lib/tauri/git';

const commits: CommitInfo[] = [
  {
    oid: 'abc123def456',
    summary: 'fix the thing',
    author: 'Ada',
    timestamp: '2026-08-14 10:00:00',
    touched: ['src/a.ts'],
  },
  {
    oid: 'fff000111222',
    summary: 'add a.ts',
    author: 'Grace',
    timestamp: '2026-08-13 09:00:00',
    touched: ['src/a.ts'],
  },
];

describe('HistoryView', () => {
  it('asks to open a file when no history path is set', () => {
    render(<HistoryView historyPath={null} commits={[]} />);

    expect(screen.getByText('Open a file to see its history.')).toBeInTheDocument();
    expect(screen.queryByTestId('git-history-list')).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(<HistoryView historyPath="src/a.ts" commits={[]} loading />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders commits with summary, author and timestamp', () => {
    render(<HistoryView historyPath="src/a.ts" commits={commits} />);

    const list = screen.getByTestId('git-history-list');
    expect(list).toHaveTextContent('fix the thing');
    expect(list).toHaveTextContent('Ada');
    expect(list).toHaveTextContent('2026-08-14 10:00:00');
    expect(list).toHaveTextContent('add a.ts');
    expect(list).toHaveTextContent('Grace');
  });

  it('calls onCommitClick with the oid when a commit is clicked', async () => {
    const user = userEvent.setup();
    const onCommitClick = vi.fn();
    render(<HistoryView historyPath="src/a.ts" commits={commits} onCommitClick={onCommitClick} />);

    await user.click(screen.getByText('fix the thing'));
    expect(onCommitClick).toHaveBeenCalledWith('abc123def456');
  });
});

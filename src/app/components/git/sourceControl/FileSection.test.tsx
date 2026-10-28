import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GIT_LIST_PAGE_SIZE } from '@/lib/git/listCap';
import type { GitFileStatus } from '@/lib/tauri/git';
import { FileSection } from './FileSection';

function untracked(count: number): GitFileStatus[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `out/file-${i}.js`,
    status: 'untracked',
    staged: null,
    unstaged: 'untracked',
  }));
}

function renderSection(files: GitFileStatus[]) {
  return render(
    <FileSection
      title="Untracked"
      testId="untracked-files"
      files={files}
      side="unstaged"
      actionKind="stage"
      onAction={vi.fn()}
    />
  );
}

describe('FileSection with a huge list', () => {
  it('draws one page, keeps the real count in the header and offers the rest', () => {
    renderSection(untracked(51_435));

    expect(screen.getByText('Untracked (51,435)')).toBeInTheDocument();
    expect(screen.getAllByText(/file-\d+\.js/)).toHaveLength(GIT_LIST_PAGE_SIZE);
    expect(screen.getByTestId('untracked-files-cap')).toHaveTextContent(
      `Showing the first ${GIT_LIST_PAGE_SIZE} of 51,435`
    );
  });

  it('shows the next page on request', () => {
    renderSection(untracked(GIT_LIST_PAGE_SIZE * 2 + 5));

    fireEvent.click(screen.getByRole('button', { name: /show more/i }));

    expect(screen.getAllByText(/file-\d+\.js/)).toHaveLength(GIT_LIST_PAGE_SIZE * 2);
  });

  it('shows everything on "Show all"', () => {
    renderSection(untracked(GIT_LIST_PAGE_SIZE + 7));

    fireEvent.click(screen.getByRole('button', { name: /show all/i }));

    expect(screen.getAllByText(/file-\d+\.js/)).toHaveLength(GIT_LIST_PAGE_SIZE + 7);
    expect(screen.queryByTestId('untracked-files-cap')).not.toBeInTheDocument();
  });

  it('adds no hint for a normal list', () => {
    renderSection(untracked(3));
    expect(screen.queryByTestId('untracked-files-cap')).not.toBeInTheDocument();
  });
});

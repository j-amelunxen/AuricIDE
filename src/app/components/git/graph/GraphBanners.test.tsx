import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GraphBanners, GraphEmptyState } from './GraphBanners';
import { makeRefs } from './testGraph';

const handlers = () => ({ onCheckoutBranch: vi.fn(), onOpenMergePanel: vi.fn() });

describe('GraphBanners', () => {
  it('shows nothing for a healthy repository', () => {
    render(<GraphBanners refs={makeRefs([])} {...handlers()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('explains a detached HEAD and offers to check out a branch', async () => {
    const user = userEvent.setup();
    const h = handlers();
    render(
      <GraphBanners refs={makeRefs([], { headDetached: true, headOid: 'abcdef1234567' })} {...h} />
    );
    expect(
      screen.getByRole('button', { name: 'Check Out a Branch…' }).parentElement
    ).toHaveTextContent('HEAD is detached at abcdef1.');
    expect(screen.getByRole('status')).toHaveTextContent('HEAD is detached at abcdef1.');
    await user.click(screen.getByRole('button', { name: 'Check Out a Branch…' }));
    expect(h.onCheckoutBranch).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number) })
    );
  });

  it.each([
    ['cherry-pick', 'A cherry-pick is in progress.'],
    ['revert', 'A revert is in progress.'],
    ['merge', 'A merge is in progress.'],
    ['rebase', 'A rebase is in progress.'],
    ['other', 'An operation is in progress.'],
  ] as const)('names the running %s and opens the merge panel', async (operation, text) => {
    const user = userEvent.setup();
    const h = handlers();
    render(<GraphBanners refs={makeRefs([], { operation })} {...h} />);
    expect(
      screen.getByRole('button', { name: 'Open Merge Panel' }).parentElement
    ).toHaveTextContent(text);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    await user.click(screen.getByRole('button', { name: 'Open Merge Panel' }));
    expect(h.onOpenMergePanel).toHaveBeenCalledTimes(1);
  });
});

describe('GraphBanners live region', () => {
  it('exists before there is anything to say, then receives the text, so it is announced', () => {
    const { rerender } = render(<GraphBanners refs={null} {...handlers()} />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    rerender(<GraphBanners refs={makeRefs([], { operation: 'revert' })} {...handlers()} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('A revert is in progress.');
  });
});

describe('GraphEmptyState', () => {
  it('says a folder is not a repository', () => {
    render(<GraphEmptyState kind="no-repo" />);
    expect(screen.getByText('Not a git repository')).toBeInTheDocument();
  });

  it('says there are no commits yet', () => {
    render(<GraphEmptyState kind="no-commits" />);
    expect(screen.getByText('No commits yet')).toBeInTheDocument();
  });

  it('offers a retry when loading failed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <GraphEmptyState
        kind="error"
        message="Could not read the commit history."
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read the commit history.');
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('announces loading politely', () => {
    render(<GraphEmptyState kind="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history…');
  });
});

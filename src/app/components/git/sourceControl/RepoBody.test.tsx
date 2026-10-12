import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { RepoBody, type RepoBodyProps } from './RepoBody';
import type { RepoView } from './types';

const REPO = '/work/app';

const repo: RepoView = {
  repoPath: REPO,
  label: 'app',
  kind: 'root',
  branchName: 'main',
  fileStatuses: [{ path: 'src/a.ts', status: 'conflicted', staged: null, unstaged: 'conflicted' }],
  commitMessage: '',
  isCommitting: false,
  isPushing: false,
};

function renderBody(overrides: Partial<RepoBodyProps> = {}) {
  return render(
    <RepoBody
      repo={repo}
      agenticCommit={false}
      renderAgenticControls={false}
      providers={[]}
      onCommitMessageChange={vi.fn()}
      onCommit={vi.fn()}
      onStageFile={vi.fn()}
      onUnstageFile={vi.fn()}
      {...overrides}
    />
  );
}

describe('RepoBody during a merge', () => {
  beforeEach(() => {
    useStore.setState({ mergeStates: {} });
  });

  it('turns the commit box into the merge banner and does not claim there are no changes', () => {
    useStore.setState({
      mergeStates: {
        [REPO]: {
          inProgress: true,
          operation: 'merge',
          oursLabel: 'main',
          theirsLabel: 'feature/x',
          theirsOid: 'abc',
          message: null,
          conflicts: [{ path: 'src/a.ts', kind: 'content' }],
        },
      },
    });
    renderBody();

    expect(screen.getByRole('region', { name: 'Merge in progress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    expect(screen.getByText('No other changes')).toBeInTheDocument();
  });

  it('offers merging a branch when no merge is running', () => {
    renderBody({ repo: { ...repo, fileStatuses: [] } });
    expect(screen.getByRole('button', { name: 'Commit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge into main…' })).toBeInTheDocument();
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });
});

describe('RepoBody review and commit focus', () => {
  const clean: RepoView = { ...repo, fileStatuses: [] };
  const changed: RepoView = {
    ...repo,
    fileStatuses: [{ path: 'src/a.ts', status: 'modified', staged: null, unstaged: 'modified' }],
  };

  beforeEach(() => {
    useStore.setState({ mergeStates: {}, commitFocusRequest: null });
  });

  it('offers a review of the repo only while it has changes', () => {
    const { rerender } = renderBody({ repo: clean });
    expect(screen.queryByTestId('review-changes-button')).not.toBeInTheDocument();
    rerender(
      <RepoBody
        repo={changed}
        agenticCommit={false}
        renderAgenticControls={false}
        providers={[]}
        onCommitMessageChange={vi.fn()}
        onCommit={vi.fn()}
        onStageFile={vi.fn()}
        onUnstageFile={vi.fn()}
      />
    );
    expect(screen.getByTestId('review-changes-button')).toBeInTheDocument();
  });

  it('focuses the commit box when a review approves this repo, and only this repo', () => {
    renderBody({ repo: changed });
    act(() => useStore.getState().requestCommitFocus('/elsewhere'));
    expect(screen.getByRole('textbox', { name: 'Commit message' })).not.toHaveFocus();

    act(() => useStore.getState().requestCommitFocus(REPO));
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveFocus();
    expect(useStore.getState().commitFocusRequest).toBeNull();
  });

  it('takes a request made before it mounted', () => {
    useStore.getState().requestCommitFocus(REPO);
    renderBody({ repo: changed });
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveFocus();
  });
});

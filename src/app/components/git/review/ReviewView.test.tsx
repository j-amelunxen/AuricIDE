import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  patchHash,
  viewedMarksKey,
  reviewTabId,
  type ReviewFile,
  type ReviewSource,
} from '@/lib/git/review/reviewSession';
import { riskFlagsForPatch } from '@/lib/git/review/riskFlags';
import { useStore } from '@/lib/store';
import { ReviewView } from './ReviewView';

const mockGetGitDiff = vi.hoisted(() => vi.fn());

vi.mock('@/lib/tauri/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/git')>();
  return { ...actual, getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args) };
});

const REPO = '/work/app';
const WT_MARKS = viewedMarksKey({ kind: 'worktree', repoPath: REPO });

function patchFor(path: string, body: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`;
}

function reviewFile(
  path: string,
  body: string,
  status: ReviewFile['status'] = 'modified'
): ReviewFile {
  const patch = patchFor(path, body);
  return { path, status, patch, flags: riskFlagsForPatch(path, patch), hash: patchHash(patch) };
}

const testFile = reviewFile(
  'src/login.test.ts',
  "@@ -1,4 +1,2 @@\n describe('login', () => {\n-  it('redirects', () => {});\n-  it('keeps the session', () => {});\n });\n"
);
const viewedFile = reviewFile('src/a.ts', '@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n');
const changedFile = reviewFile('src/b.ts', '@@ -3,1 +3,1 @@\n-const b = 1;\n+const b = 3;\n');
const lockFile = reviewFile('pnpm-lock.yaml', '@@ -1,1 +1,1 @@\n-x: 1\n+x: 2\n');
const FILES = [testFile, viewedFile, changedFile, lockFile];

const worktreeSource: ReviewSource = { kind: 'worktree', repoPath: REPO };
const TAB = reviewTabId(worktreeSource);

function seed(
  files: ReviewFile[],
  opts: { loading?: boolean; source?: ReviewSource; tabId?: string } = {}
) {
  const source = opts.source ?? worktreeSource;
  useStore.setState({
    reviewSessions: {
      [opts.tabId ?? TAB]: { source, files, loading: opts.loading ?? false, error: null },
    },
  });
}

const applyHunkAction = vi.fn();
const closeTab = vi.fn();

beforeEach(() => {
  mockGetGitDiff
    .mockReset()
    .mockImplementation(async (_repo: string, path: string, side?: string) => {
      const file = FILES.find((f) => f.path === path);
      return side === 'unstaged' && file ? file.patch : '';
    });
  applyHunkAction.mockReset().mockResolvedValue(undefined);
  closeTab.mockReset();
  useStore.setState({
    reviewSessions: {},
    viewedMarks: {
      [WT_MARKS]: { [viewedFile.path]: viewedFile.hash, [changedFile.path]: 'stale-hash' },
    },
    reviewComments: [],
    agents: [],
    pmTickets: [],
    agentWorktrees: [],
    spawnDialogOpen: false,
    applyHunkAction,
    closeTab,
    refreshReviewSession: vi.fn().mockResolvedValue(undefined),
    refreshReviewFile: vi.fn().mockResolvedValue(undefined),
    refreshRepoStatus: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  });
});

function sectionFor(path: string): HTMLElement {
  return screen
    .getAllByTestId('review-file-section')
    .find((s) => s.getAttribute('data-review-path') === path)!;
}

describe('ReviewView', () => {
  it('shows the loading state, then the files once they arrive', () => {
    seed([], { loading: true });
    const { rerender } = render(<ReviewView tabId={TAB} />);
    expect(screen.getByText('Reading the changes')).toBeInTheDocument();
    expect(screen.queryByTestId('review-file-section')).not.toBeInTheDocument();

    act(() => seed(FILES));
    rerender(<ReviewView tabId={TAB} />);
    expect(screen.getAllByTestId('review-file-section')).toHaveLength(4);
    expect(screen.getByTestId('review-progress')).toHaveTextContent('1 of 4 viewed');
  });

  it('says so when there is nothing to review', () => {
    seed([]);
    render(<ReviewView tabId={TAB} />);
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Nothing to review');
  });

  it('lists files in the given order with their viewed state and flag count', () => {
    seed(FILES);
    render(<ReviewView tabId={TAB} />);
    const items = screen.getAllByTestId('review-file-item');
    expect(items.map((i) => i.getAttribute('title'))).toEqual(FILES.map((f) => f.path));
    expect(items.map((i) => i.getAttribute('data-viewed'))).toEqual([
      'unviewed',
      'viewed',
      'changed-since-viewed',
      'unviewed',
    ]);
    expect(within(items[0]).getByTestId('review-file-flag-count')).toHaveTextContent('1');
  });

  it('folds viewed files without rendering their patch, and flags a changed one', () => {
    seed(FILES);
    render(<ReviewView tabId={TAB} />);
    expect(within(sectionFor('src/a.ts')).queryByText('const a = 2;')).not.toBeInTheDocument();
    expect(within(sectionFor('src/b.ts')).getByText('const b = 3;')).toBeInTheDocument();
    expect(within(sectionFor('src/b.ts')).getByTestId('review-changed-note')).toHaveTextContent(
      'Changed since you viewed it'
    );
  });

  it('puts the hunk flag on the hunk and the lockfile flag in the file header', () => {
    seed(FILES);
    render(<ReviewView tabId={TAB} />);
    const chip = within(sectionFor(testFile.path)).getByTestId('risk-chip');
    expect(chip).toHaveAttribute('data-kind', 'test-removed');
    expect(chip.closest('[data-testid="hunk-toolbar"]')).not.toBeNull();
    const lockChip = within(sectionFor('pnpm-lock.yaml')).getByTestId('risk-chip');
    expect(lockChip).toHaveAttribute('data-kind', 'lockfile');
    expect(lockChip.closest('header')).not.toBeNull();
  });

  it('moves between files with ] and [, and V marks the current one and moves on', () => {
    seed(FILES);
    render(<ReviewView tabId={TAB} />);
    const view = screen.getByTestId('review-view');
    const current = () =>
      screen.getAllByTestId('review-file-item').find((i) => i.getAttribute('aria-current'));
    expect(current()).toHaveAttribute('title', testFile.path);
    fireEvent.keyDown(view, { key: ']' });
    fireEvent.keyDown(view, { key: ']' });
    expect(current()).toHaveAttribute('title', changedFile.path);
    fireEvent.keyDown(view, { key: '[' });
    expect(current()).toHaveAttribute('title', viewedFile.path);

    fireEvent.keyDown(view, { key: ']' });
    fireEvent.keyDown(view, { key: 'v' });
    expect(useStore.getState().viewedMarks[WT_MARKS][changedFile.path]).toBe(changedFile.hash);
    expect(current()).toHaveAttribute('title', lockFile.path);
  });

  it('holds Approve while files are not viewed, and Approve anyway still commits', async () => {
    const onApprove = vi.fn();
    seed(FILES);
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} onApproveWorkingTree={onApprove} />);
    expect(screen.getByTestId('review-approve')).toBeDisabled();
    expect(screen.getByTestId('review-approve-reason')).toHaveTextContent(
      '2 files not viewed yet, 1 changed since you viewed it'
    );
    await user.click(screen.getByTestId('review-approve-anyway'));
    expect(onApprove).toHaveBeenCalledWith(REPO);
    expect(closeTab).toHaveBeenCalledWith(TAB);
  });

  it('enables Approve once everything is viewed', () => {
    seed([viewedFile]);
    render(<ReviewView tabId={TAB} />);
    expect(screen.getByTestId('review-approve')).toBeEnabled();
    expect(screen.queryByTestId('review-approve-anyway')).not.toBeInTheDocument();
  });

  it('⌘↵ never lands on Approve anyway: with files left it goes to the first one to read', async () => {
    seed(FILES);
    render(<ReviewView tabId={TAB} />);
    fireEvent.keyDown(screen.getByTestId('review-view'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('review-view'), { key: 'Enter', metaKey: true });
    const header = sectionFor(testFile.path).querySelector('[data-review-header]');
    await waitFor(() => expect(document.activeElement).toBe(header));
    expect(screen.getByTestId('review-approve-anyway')).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('requests changes with the open comments and marks them sent once an agent runs', async () => {
    seed(FILES);
    useStore.getState().addReviewComment({
      repoPath: REPO,
      filePath: 'src/b.ts',
      lineNo: 3,
      side: 'new',
      lineContent: 'const b = 3;',
      body: 'Why 3?',
    });
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} />);
    const request = screen.getByTestId('review-request-changes');
    expect(request).toHaveTextContent('(1)');
    await user.click(request);
    expect(useStore.getState().spawnDialogOpen).toBe(true);
    expect(useStore.getState().initialAgentTask).toContain('Why 3?');

    act(() => {
      useStore.setState({
        agents: [
          {
            id: 'n',
            name: 'fixer',
            status: 'running',
            model: 'm',
            provider: 'p',
            startedAt: 5,
            currentTask: useStore.getState().initialAgentTask,
          },
        ],
      });
      useStore.setState({ spawnDialogOpen: false });
    });
    expect(useStore.getState().reviewComments[0].sentInRound).toBe(1);
    expect(within(sectionFor('src/b.ts')).getByText('Sent in round 1')).toBeInTheDocument();
    expect(screen.getByTestId('review-request-changes')).toBeDisabled();
  });

  it('accepts one hunk by staging it from the unstaged patch', async () => {
    seed([changedFile]);
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} />);
    const accept = await within(sectionFor('src/b.ts')).findByRole('button', {
      name: 'Accept hunk 1 of 1 in b.ts',
    });
    await user.click(accept);
    await waitFor(() =>
      expect(applyHunkAction).toHaveBeenCalledWith(REPO, 'src/b.ts', changedFile.patch, 0, 'stage')
    );
    expect(useStore.getState().refreshReviewFile).toHaveBeenCalledWith(TAB, 'src/b.ts');
    expect(useStore.getState().refreshReviewSession).not.toHaveBeenCalled();
  });

  it('says why it falls back to whole-file actions when hunks do not line up', async () => {
    mockGetGitDiff.mockImplementation(async (_r: string, _p: string, side?: string) =>
      side === 'unstaged'
        ? patchFor('src/b.ts', '@@ -3,1 +3,1 @@\n-const b = 2;\n+const b = 3;\n')
        : ''
    );
    seed([changedFile]);
    render(<ReviewView tabId={TAB} />);
    expect(await screen.findByTestId('review-hunk-fallback')).toHaveTextContent(/already staged/);
    expect(
      screen.queryByRole('button', { name: 'Accept hunk 1 of 1 in b.ts' })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('review-accept-file')).toBeInTheDocument();
  });

  it('offers no accept or reject when reviewing against a ref', () => {
    const source: ReviewSource = { kind: 'ref', repoPath: REPO, ref: 'main' };
    const tabId = reviewTabId(source);
    seed([changedFile], { source, tabId });
    render(<ReviewView tabId={tabId} />);
    expect(screen.queryByTestId('review-accept-file')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Accept hunk 1 of 1 in b.ts' })
    ).not.toBeInTheDocument();
    expect(mockGetGitDiff).not.toHaveBeenCalled();
  });

  it('shows who wrote an agent worktree and for which ticket, and nothing otherwise', () => {
    const wt = '/work/app.auric-wt/fix-login';
    const source: ReviewSource = { kind: 'worktree', repoPath: wt };
    const tabId = reviewTabId(source);
    seed([changedFile], { source, tabId });
    useStore.setState({
      agents: [
        {
          id: 'a',
          name: 'fix-login',
          status: 'idle',
          model: 'm',
          provider: 'p',
          startedAt: 1,
          repoPath: wt,
          currentTask: 'Fix the redirect after login',
          spawnedByTicketId: 't1',
        },
      ],
      pmTickets: [{ id: 't1', name: 'Login redirect loops' } as never],
    });
    const { unmount } = render(<ReviewView tabId={tabId} />);
    const intent = screen.getByTestId('review-intent');
    expect(intent).toHaveTextContent('Written by fix-login for Login redirect loops');
    expect(intent).toHaveTextContent('Fix the redirect after login');
    expect(screen.getByTestId('review-approve-anyway')).toBeInTheDocument();
    expect(screen.getByTestId('review-approve')).toHaveTextContent('Approve and merge');
    unmount();

    seed(FILES);
    render(<ReviewView tabId={TAB} />);
    expect(screen.queryByTestId('review-intent')).not.toBeInTheDocument();
  });

  it('offers only Discard in an agent worktree, where the merge takes everything', async () => {
    const wt = '/work/app.auric-wt/fix-login';
    const source: ReviewSource = { kind: 'worktree', repoPath: wt };
    const tabId = reviewTabId(source);
    seed([changedFile], { source, tabId });
    render(<ReviewView tabId={tabId} />);
    expect(
      await within(sectionFor('src/b.ts')).findByRole('button', {
        name: 'Discard hunk 1 of 1 in b.ts',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Accept hunk 1 of 1 in b.ts' })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-accept-file')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-discard-file')).toBeInTheDocument();
  });

  it('names the merge base as the branch, and says so when it fell back to the tip', () => {
    const wt = '/work/app.auric-wt/fix-login';
    const merged: ReviewSource = {
      kind: 'ref',
      repoPath: wt,
      ref: 'main',
      base: { kind: 'merge-base', oid: 'a'.repeat(40) },
    };
    const tabId = reviewTabId(merged);
    seed([changedFile], { source: merged, tabId });
    const { unmount } = render(<ReviewView tabId={tabId} />);
    expect(screen.getByText('Changes since it left main')).toBeInTheDocument();
    expect(screen.queryByTestId('review-base-fallback')).not.toBeInTheDocument();
    unmount();

    seed([changedFile], {
      source: { ...merged, base: { kind: 'tip', reason: 'no common ancestor' } },
      tabId,
    });
    render(<ReviewView tabId={tabId} />);
    expect(screen.getByText('Against the tip of main')).toBeInTheDocument();
    expect(screen.getByTestId('review-base-fallback')).toHaveTextContent(
      'Could not find where this branch left main'
    );
  });
});

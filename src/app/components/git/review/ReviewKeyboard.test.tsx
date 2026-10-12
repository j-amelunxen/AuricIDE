import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  patchHash,
  viewedMarksKey,
  reviewTabId,
  type ReviewFile,
} from '@/lib/git/review/reviewSession';
import { useStore } from '@/lib/store';
import { ReviewView } from './ReviewView';

const mockGetGitDiff = vi.hoisted(() => vi.fn());

vi.mock('@/lib/tauri/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/git')>()),
  getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args),
}));

const REPO = '/work/app';
const WT_MARKS = viewedMarksKey({ kind: 'worktree', repoPath: REPO });
const TAB = reviewTabId({ kind: 'worktree', repoPath: REPO });

function file(path: string, body: string): ReviewFile {
  const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`;
  return { path, status: 'modified', patch, flags: [], hash: patchHash(patch) };
}

// Two hunks far apart, so each maps one to one onto the unstaged patch.
const first = file(
  'src/first.ts',
  '@@ -1,1 +1,1 @@\n-const one = 1;\n+const one = 2;\n@@ -40,1 +40,1 @@\n-const two = 1;\n+const two = 2;\n'
);
const second = file('src/second.ts', '@@ -3,1 +3,1 @@\n-const b = 1;\n+const b = 3;\n');
const done = file('src/done.ts', '@@ -1,1 +1,1 @@\n-x\n+y\n');
const FILES = [first, second, done];

const applyHunkAction = vi.fn();

function seed(files = FILES) {
  useStore.setState({
    reviewSessions: {
      [TAB]: { source: { kind: 'worktree', repoPath: REPO }, files, loading: false, error: null },
    },
  });
}

function activeIsNotBody() {
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).not.toBeNull();
}

function section(path: string): HTMLElement {
  return screen
    .getAllByTestId('review-file-section')
    .find((s) => s.getAttribute('data-review-path') === path)!;
}

function view() {
  return screen.getByTestId('review-view');
}

beforeEach(() => {
  mockGetGitDiff
    .mockReset()
    .mockImplementation(async (_r: string, path: string, side?: string) =>
      side === 'unstaged' ? (FILES.find((f) => f.path === path)?.patch ?? '') : ''
    );
  applyHunkAction.mockReset().mockResolvedValue(undefined);
  useStore.setState({
    reviewSessions: {},
    viewedMarks: { [WT_MARKS]: { [done.path]: done.hash } },
    reviewComments: [],
    agents: [],
    pmTickets: [],
    agentWorktrees: [],
    spawnDialogOpen: false,
    applyHunkAction,
    refreshReviewSession: vi.fn().mockResolvedValue(undefined),
    refreshReviewFile: vi.fn().mockResolvedValue(undefined),
    refreshRepoStatus: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  });
});

describe('Review keyboard and focus', () => {
  it('lands on the first unviewed file on open, and ↓/↑ walk the hunks across files', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    const firstHeader = section(first.path).querySelector('[data-review-header]');
    await waitFor(() => expect(document.activeElement).toBe(firstHeader));

    fireEvent.keyDown(view(), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 2 in first.ts')
    );
    fireEvent.keyDown(view(), { key: 'j' });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 2 of 2 in first.ts')
    );
    fireEvent.keyDown(view(), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 1 in second.ts')
    );
    fireEvent.keyDown(view(), { key: 'k' });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 2 of 2 in first.ts')
    );
  });

  it('shows the focused hunk its actions with keys, the rest of the file half visible', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    fireEvent.keyDown(view(), { key: 'ArrowDown' });
    const bars = await within(section(first.path)).findAllByTestId('hunk-toolbar');
    await waitFor(() =>
      expect(bars[0].querySelector('[data-visibility]')).toHaveAttribute(
        'data-visibility',
        'focused'
      )
    );
    expect(bars[1].querySelector('[data-visibility]')).toHaveAttribute('data-visibility', 'dim');
    const accept = within(bars[0]).getByRole('button', { name: 'Accept hunk 1 of 2 in first.ts' });
    expect(accept).toHaveAttribute('aria-keyshortcuts', 'S');
    expect(accept).toHaveAttribute('title', 'Stages this hunk. Undo accept reverts it. (S)');
    expect(accept.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true');
  });

  it('S accepts the focused hunk, announces it and moves to the next hunk', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    await within(section(first.path)).findAllByRole('button', { name: /Accept hunk/ });
    fireEvent.keyDown(view(), { key: 'ArrowDown' });
    fireEvent.keyDown(view(), { key: 's' });
    await waitFor(() =>
      expect(applyHunkAction).toHaveBeenCalledWith(REPO, first.path, first.patch, 0, 'stage')
    );
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 2 of 2 in first.ts')
    );
    expect(screen.getByTestId('review-live')).toHaveTextContent('Accepted hunk 1 in first.ts');
  });

  it('⌫ asks first, discards, and focus never falls to body', async () => {
    const user = userEvent.setup();
    seed();
    render(<ReviewView tabId={TAB} />);
    await within(section(first.path)).findAllByRole('button', { name: /Discard hunk/ });
    fireEvent.keyDown(view(), { key: 'ArrowDown' });
    fireEvent.keyDown(view(), { key: 'Backspace' });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Discard hunk');
    await user.click(within(dialog).getByRole('button', { name: 'Discard hunk' }));
    await waitFor(() =>
      expect(applyHunkAction).toHaveBeenCalledWith(REPO, first.path, first.patch, 0, 'discard')
    );
    // The discarded hunk goes away; the one after it moves up into its place.
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 2 in first.ts')
    );
    expect(screen.getByTestId('review-live')).toHaveTextContent('Discarded hunk 1 in first.ts');
  });

  it('V folds the file and moves on to the next unviewed one', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    await waitFor(() => activeIsNotBody());
    fireEvent.keyDown(view(), { key: 'v' });
    const secondHeader = section(second.path).querySelector('[data-review-header]');
    await waitFor(() => expect(document.activeElement).toBe(secondHeader));
    expect(screen.getByTestId('review-live')).toHaveTextContent('first.ts marked viewed');
    // The last unviewed file: nothing left to read, so focus goes to the verdict.
    fireEvent.keyDown(view(), { key: 'v' });
    await waitFor(() => expect(screen.getByTestId('review-approve')).toHaveFocus());
  });

  it('after a comment is saved or cancelled focus goes back to the review', async () => {
    const user = userEvent.setup();
    seed();
    render(<ReviewView tabId={TAB} />);
    await waitFor(() => activeIsNotBody());
    await user.click(
      within(section(second.path)).getByRole('button', { name: 'Comment on line 3' })
    );
    await user.type(screen.getByRole('textbox', { name: 'Review comment' }), 'Why 3?');
    await user.click(screen.getByRole('button', { name: 'Save comment' }));
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 1 in second.ts')
    );
    expect(screen.getByTestId('review-live')).toHaveTextContent('Comment saved');

    await user.click(
      within(section(second.path)).getByRole('button', { name: 'Comment on line 3' })
    );
    await user.keyboard('{Escape}');
    await waitFor(() => activeIsNotBody());
  });

  it('C opens the composer on the focused hunk, Esc and save return focus to that hunk', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    await waitFor(() => activeIsNotBody());
    fireEvent.keyDown(view(), { key: ']' });
    fireEvent.keyDown(view(), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 1 in second.ts')
    );

    fireEvent.keyDown(document.activeElement!, { key: 'c' });
    const composer = within(section(second.path)).getByRole('textbox', { name: 'Review comment' });
    await waitFor(() => expect(document.activeElement).toBe(composer));
    fireEvent.keyDown(composer, { key: 'Escape' });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 1 in second.ts')
    );

    fireEvent.keyDown(document.activeElement!, { key: 'C' });
    const again = within(section(second.path)).getByRole('textbox', { name: 'Review comment' });
    fireEvent.change(again, { target: { value: 'Why 3?' } });
    fireEvent.keyDown(again, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('aria-label', 'Hunk 1 of 1 in second.ts')
    );
    expect(useStore.getState().reviewComments).toEqual([
      expect.objectContaining({
        filePath: second.path,
        side: 'new',
        lineNo: 3,
        lineContent: 'const b = 3;',
        body: 'Why 3?',
      }),
    ]);
  });

  it('C on a file header does nothing', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    const firstHeader = section(first.path).querySelector('[data-review-header]');
    await waitFor(() => expect(document.activeElement).toBe(firstHeader));
    fireEvent.keyDown(view(), { key: 'c' });
    expect(screen.queryByRole('textbox', { name: 'Review comment' })).toBeNull();
    expect(document.activeElement).toBe(firstHeader);
  });

  it('? opens the shortcut sheet', async () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    fireEvent.keyDown(view(), { key: '?' });
    const sheet = await screen.findByRole('dialog', { name: 'Review shortcuts' });
    expect(sheet).toHaveTextContent('Discard the focused hunk');
    expect(sheet).toHaveTextContent('Comment on the focused hunk');
  });
});

describe('Review verdict copy and reasons', () => {
  it('says what Approve does and ties every disabled button to its visible reason', () => {
    seed();
    render(<ReviewView tabId={TAB} />);
    const approve = screen.getByTestId('review-approve');
    expect(approve).toHaveTextContent('Approve, then commit…');
    expect(approve).toBeDisabled();
    const reason = document.getElementById(approve.getAttribute('aria-describedby')!);
    expect(reason).toHaveTextContent('Approve waits: 2 files not viewed yet.');
    const request = screen.getByTestId('review-request-changes');
    expect(document.getElementById(request.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Comment on a line to request changes.'
    );
    // Progress lives in the file list only.
    expect(screen.getByTestId('review-verdict-bar')).not.toHaveTextContent('viewed ·');
    expect(screen.getAllByText(/of 3 viewed/)).toHaveLength(1);
  });
});

describe('Review in a narrow editor', () => {
  let callback: ResizeObserverCallback | null = null;
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    callback = null;
  });

  it('folds the file list away and falls back to one column, with a way back to the list', async () => {
    const user = userEvent.setup();
    seed();
    render(<ReviewView tabId={TAB} />);
    act(() =>
      callback?.([{ contentRect: { width: 600 } } as ResizeObserverEntry], {} as ResizeObserver)
    );
    expect(screen.queryByRole('navigation', { name: 'Files in this review' })).toBeNull();
    expect(screen.getByTestId('review-view-toggle')).toBeDisabled();
    expect(screen.queryByTestId('diff-side-by-side')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the file list' }));
    expect(screen.getByRole('navigation', { name: 'Files in this review' })).toBeInTheDocument();
  });
});

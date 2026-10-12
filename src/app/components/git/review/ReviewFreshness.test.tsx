import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  patchHash,
  reviewTabId,
  viewedMarksKey,
  type ReviewFile,
} from '@/lib/git/review/reviewSession';
import { useStore } from '@/lib/store';
import { ReviewView } from './ReviewView';
import { REVIEW_REFRESH_DEBOUNCE_MS } from './useReviewAutoRefresh';

vi.mock('@/lib/tauri/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/git')>()),
  getGitDiff: async () => '',
}));

const REPO = '/work/app';
const SOURCE = { kind: 'worktree' as const, repoPath: REPO };
const TAB = reviewTabId(SOURCE);
const MARKS = viewedMarksKey(SOURCE);

function file(path: string, added = 'b'): ReviewFile {
  const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n-a\n+${added}\n`;
  return { path, status: 'modified', patch, flags: [], hash: patchHash(patch) };
}

function seed(files: ReviewFile[]) {
  useStore.setState({
    reviewSessions: { [TAB]: { source: SOURCE, files, loading: false, error: null } },
  });
}

function markAllViewed(files: ReviewFile[]) {
  useStore.setState({
    viewedMarks: { [MARKS]: Object.fromEntries(files.map((f) => [f.path, f.hash])) },
  });
}

const onApprove = vi.fn();

beforeEach(() => {
  onApprove.mockReset();
  useStore.setState({
    reviewSessions: {},
    viewedMarks: {},
    reviewComments: [],
    agents: [],
    pmTickets: [],
    agentWorktrees: [],
    repoStates: {},
    openTabs: [{ id: TAB, path: REPO, name: 'Review: app' }],
    closeTab: vi.fn(),
    refreshReviewSession: vi.fn(async () => undefined),
    refreshReviewFile: vi.fn(async () => undefined),
    showToast: vi.fn(),
  });
});

describe('Approve reads the changes again first', () => {
  it('approves when the re-read finds what the reviewer saw', async () => {
    const files = [file('a.ts')];
    seed(files);
    markAllViewed(files);
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} onApproveWorkingTree={onApprove} />);
    await user.click(screen.getByTestId('review-approve'));
    expect(useStore.getState().refreshReviewSession).toHaveBeenCalledWith(TAB);
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(REPO));
  });

  it('refuses, with the reason, when an agent changed a file since it was viewed', async () => {
    const files = [file('a.ts')];
    seed(files);
    markAllViewed(files);
    useStore.setState({
      refreshReviewSession: vi.fn(async () => seed([file('a.ts', 'changed')])),
    });
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} onApproveWorkingTree={onApprove} />);
    await user.click(screen.getByTestId('review-approve'));
    expect(await screen.findByTestId('review-approve-refusal')).toHaveTextContent(
      'The changes moved on while you reviewed. Approve waits: 1 changed since you viewed it.'
    );
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('refuses while an agent is still running in the repo, Approve anyway included', async () => {
    const files = [file('a.ts')];
    seed([...files, file('b.ts')]);
    markAllViewed(files);
    useStore.setState({
      agents: [
        {
          id: 'x',
          name: 'x',
          status: 'running',
          model: 'm',
          provider: 'p',
          startedAt: 1,
          repoPath: REPO,
        },
      ],
    });
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} onApproveWorkingTree={onApprove} />);
    await user.click(screen.getByTestId('review-approve-anyway'));
    expect(await screen.findByTestId('review-approve-refusal')).toHaveTextContent(
      'An agent is still running here'
    );
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('asks again before Approve anyway goes through on changes the reviewer has not seen', async () => {
    seed([file('a.ts')]);
    useStore.setState({
      refreshReviewSession: vi.fn(async () => seed([file('a.ts', 'newer')])),
    });
    const user = userEvent.setup();
    render(<ReviewView tabId={TAB} onApproveWorkingTree={onApprove} />);

    await user.click(screen.getByTestId('review-approve-anyway'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 file has changed since you last looked');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onApprove).not.toHaveBeenCalled();

    // The second read finds nothing new compared with the first, so no question this time.
    await user.click(screen.getByTestId('review-approve-anyway'));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(REPO));
  });
});

describe('Large change sets', () => {
  it('opens only the first ten files still to read and says how many wait folded', async () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      file(`src/f${String(i).padStart(2, '0')}.ts`)
    );
    seed(files);
    render(<ReviewView tabId={TAB} />);
    const sections = screen.getAllByTestId('review-file-section');
    const open = sections.filter((s) => s.querySelector('[data-hunk-index]'));
    expect(open).toHaveLength(10);
    expect(screen.getByTestId('review-folded-note')).toHaveTextContent('2 more files to review');

    // O on a folded file opens it.
    const last = sections[11];
    act(() => last.querySelector<HTMLElement>('[data-review-header]')!.focus());
    fireEvent.keyDown(screen.getByTestId('review-view'), { key: 'o' });
    await waitFor(() => expect(last.querySelector('[data-hunk-index]')).not.toBeNull());
    expect(screen.getByTestId('review-folded-note')).toHaveTextContent('1 more file to review');
  });
});

describe('Refresh when the files may have changed', () => {
  it('reads the change set again when the window comes back', async () => {
    vi.useFakeTimers();
    try {
      seed([file('a.ts')]);
      render(<ReviewView tabId={TAB} />);
      act(() => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(REVIEW_REFRESH_DEBOUNCE_MS);
      });
      expect(useStore.getState().refreshReviewSession).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads it again when git status of the repo changes, not on unrelated store writes', async () => {
    vi.useFakeTimers();
    try {
      seed([file('a.ts')]);
      render(<ReviewView tabId={TAB} />);
      act(() => {
        useStore.setState({ toasts: [] } as never);
        vi.advanceTimersByTime(REVIEW_REFRESH_DEBOUNCE_MS);
      });
      expect(useStore.getState().refreshReviewSession).not.toHaveBeenCalled();
      act(() => {
        useStore.setState({
          repoStates: { [REPO]: { fileStatuses: [] } } as never,
        });
        vi.advanceTimersByTime(REVIEW_REFRESH_DEBOUNCE_MS);
      });
      expect(useStore.getState().refreshReviewSession).toHaveBeenCalledWith(TAB);
    } finally {
      vi.useRealTimers();
    }
  });
});

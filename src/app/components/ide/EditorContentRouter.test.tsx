import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphTabId } from '@/lib/git/graphTabId';
import { patchHash, viewedMarksKey, reviewTabId } from '@/lib/git/review/reviewSession';
import { useStore } from '@/lib/store';
import { EditorContentRouter } from './EditorContentRouter';

const REPO = '/work/app';
const WT_MARKS = viewedMarksKey({ kind: 'worktree', repoPath: REPO });
const tabId = reviewTabId({ kind: 'worktree', repoPath: REPO });
const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
const hash = patchHash(patch);

describe('EditorContentRouter review tabs', () => {
  beforeEach(() => {
    useStore.setState({
      reviewSessions: {
        [tabId]: {
          source: { kind: 'worktree', repoPath: REPO },
          files: [{ path: 'a.ts', status: 'modified', patch, flags: [], hash }],
          loading: false,
          error: null,
        },
      },
      viewedMarks: { [WT_MARKS]: { 'a.ts': hash } },
      reviewComments: [],
      agents: [],
      scmView: 'history',
      commitFocusRequest: null,
      refreshReviewSession: vi.fn(async () => undefined),
      openTabs: [{ id: tabId, path: REPO, name: 'Review: app' }],
      activeTabId: tabId,
    });
  });

  it('renders the review, and Approve leads to the commit box of that repo', async () => {
    const setActiveActivity = vi.fn();
    const user = userEvent.setup();
    render(
      <EditorContentRouter
        state={{ activeTabId: tabId, setActiveActivity } as never}
        handlers={{ isDiffTab: false, isMergeTab: false, isReviewTab: true } as never}
        diffTab={undefined}
      />
    );
    await user.click(screen.getByTestId('review-approve'));
    expect(setActiveActivity).toHaveBeenCalledWith('source-control');
    expect(useStore.getState().scmView).toBe('changes');
    expect(useStore.getState().commitFocusRequest?.repoPath).toBe(REPO);
    expect(useStore.getState().openTabs).toEqual([]);
    expect(useStore.getState().reviewSessions[tabId]).toBeUndefined();
  });
});

describe('EditorContentRouter graph tabs', () => {
  const GRAPH_REPO = '/work/app';

  beforeEach(() => {
    useStore.setState({
      repos: [{ path: GRAPH_REPO, name: 'app', relativePath: '', kind: 'root' }],
      graphs: {},
      openGraph: vi.fn(async () => undefined),
    } as never);
  });

  it('renders the git graph of the repo named by the tab id', () => {
    render(
      <EditorContentRouter
        state={{ activeTabId: graphTabId(GRAPH_REPO) } as never}
        handlers={{ isDiffTab: false, isMergeTab: false, isReviewTab: false } as never}
        diffTab={undefined}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading history');
    expect(useStore.getState().openGraph).toHaveBeenCalledWith(GRAPH_REPO);
  });
});

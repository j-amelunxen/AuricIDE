import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { ReviewChangesButton } from './ReviewChangesButton';

describe('ReviewChangesButton', () => {
  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
      reviewSessions: {},
      refreshReviewSession: vi.fn(async () => undefined),
    });
  });

  it('opens a working-tree review of the repo in its own tab', async () => {
    const user = userEvent.setup();
    render(<ReviewChangesButton repoPath="/work/app" />);
    await user.click(screen.getByRole('button', { name: /review changes/i }));
    const id = 'review:/work/app:worktree';
    expect(useStore.getState().reviewSessions[id]).toMatchObject({
      source: { kind: 'worktree', repoPath: '/work/app' },
    });
    expect(useStore.getState().openTabs).toEqual([
      expect.objectContaining({ id, path: '/work/app', name: 'Review: app' }),
    ]);
    expect(useStore.getState().activeTabId).toBe(id);
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWorktreesPanel } from './AgentWorktreesPanel';
import { useStore } from '@/lib/store';
import type { GitWorktree } from '@/lib/tauri/git';

const mockGetMergeBase = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauri/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/git')>()),
  getMergeBase: (...args: unknown[]) => mockGetMergeBase(...args),
}));

const tree: GitWorktree = {
  path: '/w.auric-wt/fix-ab12',
  name: 'fix-ab12',
  branch: 'auric/fix-ab12',
  sourceRepo: '/w',
  isAuric: true,
  dirty: false,
  branchAhead: false,
};

describe('AgentWorktreesPanel', () => {
  beforeEach(() => {
    useStore.setState({
      agentWorktrees: [],
      agents: [],
      removeAgentWorktree: vi.fn(async () => undefined),
      showToast: vi.fn(),
    });
  });

  it('renders nothing when there are no worktrees', () => {
    const { container } = render(<AgentWorktreesPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a worktree and removes a clean one after confirm', async () => {
    const remove = vi.fn(async () => undefined);
    useStore.setState({ agentWorktrees: [tree], removeAgentWorktree: remove });
    const user = userEvent.setup();
    render(<AgentWorktreesPanel />);

    expect(screen.getByText('auric/fix-ab12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /remove/i }));

    expect(remove).toHaveBeenCalledWith(tree.path, false);
  });

  it('blocks remove while an agent is running in the worktree', () => {
    useStore.setState({
      agentWorktrees: [tree],
      agents: [
        {
          id: 'agent-1',
          name: 'Writer',
          model: 'm',
          provider: 'claude',
          status: 'running',
          startedAt: 1,
          repoPath: tree.path,
        },
      ],
    });
    render(<AgentWorktreesPanel />);
    expect(screen.getByText(/agent running/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeDisabled();
  });
});

describe('AgentWorktreesPanel review entry', () => {
  beforeEach(() => {
    useStore.setState({
      agents: [],
      openTabs: [],
      reviewSessions: {},
      showToast: vi.fn(),
      refreshReviewSession: vi.fn(async () => undefined),
      defaultBranchFor: vi.fn(async () => 'main'),
    });
  });

  it('reviews uncommitted work as a working-tree session', async () => {
    useStore.setState({ agentWorktrees: [{ ...tree, dirty: true }] });
    const user = userEvent.setup();
    render(<AgentWorktreesPanel />);
    await user.click(screen.getByTestId('agent-worktree-review'));
    const id = `review:${tree.path}:worktree`;
    expect(useStore.getState().reviewSessions[id]?.source).toEqual({
      kind: 'worktree',
      repoPath: tree.path,
    });
    expect(useStore.getState().openTabs.find((t) => t.id === id)?.name).toBe('Review: fix-ab12');
  });

  it('reviews a branch with commits from where it left the default branch', async () => {
    mockGetMergeBase.mockReset().mockResolvedValue('b'.repeat(40));
    useStore.setState({ agentWorktrees: [{ ...tree, branchAhead: true }] });
    const user = userEvent.setup();
    render(<AgentWorktreesPanel />);
    await user.click(screen.getByTestId('agent-worktree-review'));
    expect(useStore.getState().defaultBranchFor).toHaveBeenCalledWith('/w');
    expect(mockGetMergeBase).toHaveBeenCalledWith(tree.path, 'main', 'HEAD');
    expect(useStore.getState().reviewSessions[`review:${tree.path}:ref=main`]?.source).toEqual({
      kind: 'ref',
      repoPath: tree.path,
      ref: 'main',
      base: { kind: 'merge-base', oid: 'b'.repeat(40) },
    });
  });

  it('falls back to the tip of the default branch when there is no merge base', async () => {
    mockGetMergeBase.mockReset().mockRejectedValue(new Error('no common ancestor'));
    useStore.setState({ agentWorktrees: [{ ...tree, branchAhead: true }] });
    const user = userEvent.setup();
    render(<AgentWorktreesPanel />);
    await user.click(screen.getByTestId('agent-worktree-review'));
    expect(
      useStore.getState().reviewSessions[`review:${tree.path}:ref=main`]?.source
    ).toMatchObject({
      base: { kind: 'tip', reason: 'no common ancestor' },
    });
  });

  it('offers no review when there is nothing to review', () => {
    useStore.setState({ agentWorktrees: [tree] });
    render(<AgentWorktreesPanel />);
    expect(screen.getByTestId('agent-worktree-review')).toBeDisabled();
  });
});

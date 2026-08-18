import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWorktreesPanel } from './AgentWorktreesPanel';
import { useStore } from '@/lib/store';
import type { GitWorktree } from '@/lib/tauri/git';

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

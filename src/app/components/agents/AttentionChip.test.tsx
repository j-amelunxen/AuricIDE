import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionChip } from './AttentionChip';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';

function agent(overrides: Partial<AgentInfo> & { id: string }): AgentInfo {
  return {
    provider: 'claude',
    status: 'running',
    cwd: '/tmp/project',
    startedAt: Date.now(),
    ...overrides,
  } as AgentInfo;
}

function setFleet(agents: AgentInfo[], reviewedAgentIds: string[] = []) {
  useStore.setState({ agents, reviewedAgentIds });
}

describe('AttentionChip', () => {
  beforeEach(() => {
    setFleet([]);
  });

  it('stays silent while nobody needs a human', () => {
    setFleet([agent({ id: 'a', status: 'running', lastActivityAt: Date.now() })]);
    render(<AttentionChip />);
    expect(screen.queryByTestId('attention-chip')).not.toBeInTheDocument();
  });

  it('says nothing about an empty fleet', () => {
    render(<AttentionChip />);
    expect(screen.queryByTestId('attention-chip')).not.toBeInTheDocument();
  });

  it('counts the agents that need a human', () => {
    setFleet([
      agent({ id: 'a', status: 'error' }),
      agent({ id: 'b', status: 'running', awaitingInput: true }),
      agent({ id: 'c', status: 'running', lastActivityAt: Date.now() }),
    ]);
    render(<AttentionChip />);
    expect(screen.getByTestId('attention-chip')).toHaveTextContent('2 need attention');
  });

  it('counts one agent in the singular', () => {
    setFleet([agent({ id: 'a', status: 'error' })]);
    render(<AttentionChip />);
    expect(screen.getByTestId('attention-chip')).toHaveTextContent('1 needs attention');
  });

  it('drops a reviewed failure from the count, like the rest of the panel does', () => {
    setFleet([agent({ id: 'a', status: 'error' })], ['a']);
    render(<AttentionChip />);
    expect(screen.queryByTestId('attention-chip')).not.toBeInTheDocument();
  });

  it('opens the fleet when clicked, so the count is one click from its detail', async () => {
    const onShowAgents = vi.fn();
    setFleet([agent({ id: 'a', status: 'error' })]);
    render(<AttentionChip onShowAgents={onShowAgents} />);
    await userEvent.click(screen.getByTestId('attention-chip'));
    expect(onShowAgents).toHaveBeenCalledOnce();
  });

  it('is not a drag handle — the title bar must not swallow the click', () => {
    setFleet([agent({ id: 'a', status: 'error' })]);
    render(<AttentionChip />);
    expect(screen.getByTestId('attention-chip')).not.toHaveAttribute('data-tauri-drag-region');
  });
});

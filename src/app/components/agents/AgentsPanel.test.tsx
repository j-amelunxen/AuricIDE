import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AgentsPanel } from './AgentsPanel';

const agents: AgentInfo[] = [
  {
    id: 'agent-1',
    name: 'Writer',
    model: 'claude-opus-4-6',
    provider: 'claude',
    status: 'running',
    currentTask: 'Writing docs',
    startedAt: 1000,
  },
  {
    id: 'agent-2',
    name: 'Reviewer',
    model: 'claude-sonnet-4-5-20250929',
    provider: 'claude',
    status: 'idle',
    startedAt: 2000,
  },
];

describe('AgentsPanel', () => {
  it('renders panel with data-testid', () => {
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByTestId('agents-panel')).toBeInTheDocument();
  });

  it('shows "Active Agents" header', () => {
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByText('ACTIVE AGENTS')).toBeInTheDocument();
  });

  it('renders agent cards for each agent', () => {
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByText('Writer')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('shows empty state when no agents', () => {
    render(<AgentsPanel agents={[]} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByText('No agents running')).toBeInTheDocument();
  });

  it('deploy button calls onSpawn', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<AgentsPanel agents={agents} onSpawn={onSpawn} onKill={vi.fn()} />);

    await user.click(screen.getByText('New Agent…'));
    expect(onSpawn).toHaveBeenCalled();
  });

  it('kill button on card calls onKill with agent id', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={onKill} />);

    const killButtons = screen.getAllByTitle('Terminate Agent');
    await user.click(killButtons[0]);
    expect(onKill).toHaveBeenCalledWith('agent-1');
  });

  it('groups agents by repo path', () => {
    const agentsWithRepo = [
      { ...agents[0], repoPath: '/repo-a' },
      { ...agents[1], repoPath: '/repo-b' },
    ];
    render(<AgentsPanel agents={agentsWithRepo} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByText('repo-a')).toBeInTheDocument();
    expect(screen.getByText('repo-b')).toBeInTheDocument();
  });

  it('shows Kill All per repo group', () => {
    const agentsWithRepo = [
      { ...agents[0], repoPath: '/repo-a' },
      { ...agents[1], repoPath: '/repo-a' },
    ];
    render(
      <AgentsPanel
        agents={agentsWithRepo}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onKillRepo={vi.fn()}
      />
    );
    expect(screen.getByText('Kill All')).toBeInTheDocument();
  });

  it('Kill All calls onKillRepo with repo path', async () => {
    const user = userEvent.setup();
    const onKillRepo = vi.fn();
    const agentsWithRepo = [{ ...agents[0], repoPath: '/repo-a' }];
    render(
      <AgentsPanel
        agents={agentsWithRepo}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onKillRepo={onKillRepo}
      />
    );
    await user.click(screen.getByText('Kill All'));
    expect(onKillRepo).toHaveBeenCalledWith('/repo-a');
  });

  it('renders a collapse button when onCollapse is provided', () => {
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} onCollapse={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Hide agents panel' })).toBeInTheDocument();
  });

  it('does not render a collapse button without onCollapse', () => {
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Hide agents panel' })).not.toBeInTheDocument();
  });

  it('calls onCollapse when the collapse button is clicked', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    render(
      <AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} onCollapse={onCollapse} />
    );
    await user.click(screen.getByRole('button', { name: 'Hide agents panel' }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

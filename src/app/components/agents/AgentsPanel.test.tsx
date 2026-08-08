import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo, InterruptedAgent } from '@/lib/tauri/agents';
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
    // Killing running agents now asks first (see "destructive actions" below).
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByText('Kill All'));
    expect(onKillRepo).toHaveBeenCalledWith('/repo-a');
    confirmSpy.mockRestore();
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

  describe('interrupted agents (restart persistence)', () => {
    const interrupted: InterruptedAgent[] = [
      {
        id: 'agent-9',
        name: 'Interrupted Writer',
        model: 'sonnet',
        provider: 'claude',
        task: 'refactor the parser module',
        cwd: '/repo',
        permissionMode: 'auto',
        dangerouslyIgnorePermissions: false,
        autoAcceptEdits: false,
        headless: false,
        startedAt: 3000,
      },
    ];

    it('renders no interrupted section when the list is empty', () => {
      render(
        <AgentsPanel agents={agents} interruptedAgents={[]} onSpawn={vi.fn()} onKill={vi.fn()} />
      );
      expect(screen.queryByText('INTERRUPTED')).not.toBeInTheDocument();
    });

    it('renders interrupted agents with name and task', () => {
      render(
        <AgentsPanel
          agents={[]}
          interruptedAgents={interrupted}
          onSpawn={vi.fn()}
          onKill={vi.fn()}
        />
      );
      expect(screen.getByText('INTERRUPTED')).toBeInTheDocument();
      expect(screen.getByText('Interrupted Writer')).toBeInTheDocument();
      expect(screen.getByText('refactor the parser module')).toBeInTheDocument();
    });

    it('still shows interrupted agents alongside the empty running state', () => {
      render(
        <AgentsPanel
          agents={[]}
          interruptedAgents={interrupted}
          onSpawn={vi.fn()}
          onKill={vi.fn()}
        />
      );
      expect(screen.getByText('No agents running')).toBeInTheDocument();
      expect(screen.getByText('Interrupted Writer')).toBeInTheDocument();
    });

    it('resume button calls onResumeInterrupted with the agent id', async () => {
      const user = userEvent.setup();
      const onResumeInterrupted = vi.fn();
      render(
        <AgentsPanel
          agents={[]}
          interruptedAgents={interrupted}
          onResumeInterrupted={onResumeInterrupted}
          onSpawn={vi.fn()}
          onKill={vi.fn()}
        />
      );
      await user.click(screen.getByRole('button', { name: /resume/i }));
      expect(onResumeInterrupted).toHaveBeenCalledWith('agent-9');
    });

    it('dismiss button calls onDiscardInterrupted with the agent id', async () => {
      const user = userEvent.setup();
      const onDiscardInterrupted = vi.fn();
      render(
        <AgentsPanel
          agents={[]}
          interruptedAgents={interrupted}
          onDiscardInterrupted={onDiscardInterrupted}
          onSpawn={vi.fn()}
          onKill={vi.fn()}
        />
      );
      await user.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(onDiscardInterrupted).toHaveBeenCalledWith('agent-9');
    });
  });
});

describe('AgentsPanel destructive actions', () => {
  const repoAgents: AgentInfo[] = [
    { ...agents[0], id: 'a1', status: 'running', repoPath: '/work/api' },
    { ...agents[0], id: 'a2', status: 'running', repoPath: '/work/api' },
    { ...agents[1], id: 'a3', status: 'idle', repoPath: '/work/api' },
  ];

  it('asks before killing every agent of a repo', async () => {
    const user = userEvent.setup();
    const onKillRepo = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <AgentsPanel agents={repoAgents} onSpawn={vi.fn()} onKill={vi.fn()} onKillRepo={onKillRepo} />
    );
    await user.click(screen.getByRole('button', { name: /kill all/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onKillRepo).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('says how much work the kill would end', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <AgentsPanel agents={repoAgents} onSpawn={vi.fn()} onKill={vi.fn()} onKillRepo={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: /kill all/i }));

    const message = confirmSpy.mock.calls[0][0] as string;
    expect(message).toContain('2');
    expect(message).toContain('api');
    confirmSpy.mockRestore();
  });

  it('kills the repo once confirmed', async () => {
    const user = userEvent.setup();
    const onKillRepo = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <AgentsPanel agents={repoAgents} onSpawn={vi.fn()} onKill={vi.fn()} onKillRepo={onKillRepo} />
    );
    await user.click(screen.getByRole('button', { name: /kill all/i }));

    expect(onKillRepo).toHaveBeenCalledWith('/work/api');
    confirmSpy.mockRestore();
  });
});

describe('AgentsPanel running count', () => {
  it('counts only the agents actually working', () => {
    const mixed: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running' },
      { ...agents[0], id: 'a2', status: 'running' },
      { ...agents[1], id: 'a3', status: 'idle' },
      { ...agents[1], id: 'a4', status: 'error' },
    ];
    render(<AgentsPanel agents={mixed} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByTestId('agents-running-count')).toHaveTextContent('2');
  });

  it('shows no count when nothing is running', () => {
    render(
      <AgentsPanel
        agents={[{ ...agents[1], id: 'a1', status: 'idle' }]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
      />
    );
    expect(screen.queryByTestId('agents-running-count')).not.toBeInTheDocument();
  });
});

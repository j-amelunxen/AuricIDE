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

  it('shows the agents header', () => {
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={vi.fn()} />);
    // Not "active agents" — parked and finished agents live here too.
    expect(screen.getByText('AGENTS')).toBeInTheDocument();
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
    // Ending a running agent asks first (see "killing a single agent" below).
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AgentsPanel agents={agents} onSpawn={vi.fn()} onKill={onKill} />);

    const killButtons = screen.getAllByTitle('Terminate Agent');
    await user.click(killButtons[0]);
    expect(onKill).toHaveBeenCalledWith('agent-1');
    confirmSpy.mockRestore();
  });

  it('groups agents by repo path', () => {
    const agentsWithRepo = [
      { ...agents[0], repoPath: '/repo-a' },
      { ...agents[1], status: 'running' as const, repoPath: '/repo-b' },
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

describe('AgentsPanel attention count', () => {
  it('says how many agents need a human', () => {
    const mixed: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() },
      { ...agents[1], id: 'a2', status: 'error' },
      { ...agents[1], id: 'a3', status: 'error' },
    ];
    render(<AgentsPanel agents={mixed} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByTestId('agents-attention-count')).toHaveTextContent('2 need attention');
  });

  it('uses the singular for a single agent', () => {
    const mixed: AgentInfo[] = [{ ...agents[1], id: 'a2', status: 'error' }];
    render(<AgentsPanel agents={mixed} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByTestId('agents-attention-count')).toHaveTextContent('1 needs attention');
  });

  it('counts an agent that has stalled mid-run', () => {
    const stalled: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() - 10 * 60_000 },
    ];
    render(<AgentsPanel agents={stalled} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByTestId('agents-attention-count')).toHaveTextContent('1 needs attention');
  });

  it('stays silent while nothing needs a human', () => {
    // The absence of the badge is the "all fine" signal — a zero would be
    // one more thing to read on every glance.
    const calm: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() },
      { ...agents[1], id: 'a2', status: 'idle' },
    ];
    render(<AgentsPanel agents={calm} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agents-attention-count')).not.toBeInTheDocument();
  });

  it('still counts agents whose repo group is folded shut', () => {
    // Folding hides cards, never facts.
    const hidden: AgentInfo[] = [
      { ...agents[1], id: 'a2', status: 'error', repoPath: '/work/api' },
    ];
    render(
      <AgentsPanel
        agents={hidden}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.getByTestId('agents-attention-count')).toHaveTextContent('1 needs attention');
  });

  it('still counts parked agents', () => {
    const parked: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() - 10 * 60_000 },
    ];
    render(
      <AgentsPanel
        agents={parked}
        minimizedAgentIds={['a1']}
        onToggleMinimize={vi.fn()}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByTestId('agents-attention-count')).toHaveTextContent('1 needs attention');
  });
});

describe('AgentsPanel attention section', () => {
  it('gathers the agents that need a human at the top of the panel', () => {
    const mixed: AgentInfo[] = [
      { ...agents[0], id: 'ok', name: 'Fine', status: 'running', lastActivityAt: Date.now() },
      {
        ...agents[0],
        id: 'stuck',
        name: 'Stuck',
        status: 'running',
        lastActivityAt: Date.now() - 10 * 60_000,
      },
      { ...agents[1], id: 'broken', name: 'Broken', status: 'error' },
    ];
    render(<AgentsPanel agents={mixed} onSpawn={vi.fn()} onKill={vi.fn()} />);

    const section = screen.getByTestId('attention-agents');
    expect(section).toHaveTextContent('Stuck');
    expect(section).toHaveTextContent('Broken');
    expect(section).not.toHaveTextContent('Fine');
  });

  it('does not exist while nothing needs a human', () => {
    // The section is a summons, not furniture — an empty shell of it would
    // be one more thing to glance at.
    const calm: AgentInfo[] = [
      { ...agents[0], id: 'ok', status: 'running', lastActivityAt: Date.now() },
    ];
    render(<AgentsPanel agents={calm} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByTestId('attention-agents')).not.toBeInTheDocument();
  });

  it('keeps the card of a flagged agent in its repo group', () => {
    // The section points, it does not move — cards must not jump around
    // under the cursor when an agent stalls.
    const mixed: AgentInfo[] = [
      {
        ...agents[0],
        id: 'stuck',
        name: 'Stuck',
        status: 'running',
        lastActivityAt: Date.now() - 10 * 60_000,
        repoPath: '/work/api',
      },
    ];
    render(<AgentsPanel agents={mixed} onSpawn={vi.fn()} onKill={vi.fn()} />);
    // Once as the compact pointer row, once as the full card in its group.
    expect(screen.getAllByText('Stuck').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('opens the flagged agent on click', async () => {
    const user = userEvent.setup();
    const onSelectAgent = vi.fn();
    const mixed: AgentInfo[] = [
      {
        ...agents[0],
        id: 'stuck',
        name: 'Stuck',
        status: 'running',
        lastActivityAt: Date.now() - 10 * 60_000,
      },
    ];
    render(
      <AgentsPanel
        agents={mixed}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onSelectAgent={onSelectAgent}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Check on Stuck' }));
    expect(onSelectAgent).toHaveBeenCalledWith('stuck');
  });

  it('surfaces a parked agent that started needing a human', () => {
    // Parking is a view state; a parked agent's claim on the user is not
    // parked with it.
    const parked: AgentInfo[] = [
      {
        ...agents[0],
        id: 'stuck',
        name: 'Stuck',
        status: 'running',
        lastActivityAt: Date.now() - 10 * 60_000,
      },
    ];
    render(
      <AgentsPanel
        agents={parked}
        minimizedAgentIds={['stuck']}
        onToggleMinimize={vi.fn()}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
      />
    );
    expect(screen.getByTestId('attention-agents')).toHaveTextContent('Stuck');
  });
});

describe('AgentsPanel – park the healthy fleet', () => {
  const healthy = (id: string): AgentInfo => ({
    ...agents[0],
    id,
    name: id,
    status: 'running',
    lastActivityAt: Date.now(),
  });

  it('parks every healthy working agent in one move', async () => {
    const user = userEvent.setup();
    const onToggleMinimize = vi.fn();
    const stalled: AgentInfo = {
      ...agents[0],
      id: 'stuck',
      name: 'Stuck',
      status: 'running',
      lastActivityAt: Date.now() - 10 * 60_000,
    };
    render(
      <AgentsPanel
        agents={[healthy('h1'), healthy('h2'), stalled]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onToggleMinimize={onToggleMinimize}
      />
    );

    await user.click(screen.getByRole('button', { name: /park working/i }));
    // What stays on cards afterwards is exactly what needs a human.
    expect(onToggleMinimize).toHaveBeenCalledWith('h1', true);
    expect(onToggleMinimize).toHaveBeenCalledWith('h2', true);
    expect(onToggleMinimize).not.toHaveBeenCalledWith('stuck', true);
  });

  it('does not offer the move for a single card', () => {
    render(
      <AgentsPanel
        agents={[healthy('h1')]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onToggleMinimize={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /park working/i })).not.toBeInTheDocument();
  });

  it('does not offer the move when parking is unavailable', () => {
    render(
      <AgentsPanel agents={[healthy('h1'), healthy('h2')]} onSpawn={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: /park working/i })).not.toBeInTheDocument();
  });
});

describe('AgentsPanel – attention announcements', () => {
  it('announces to assistive technology when agents need a human', () => {
    // Visual pings are exactly what a screen-reader user cannot poll — the
    // live region is their version of the amber badge.
    const troubled: AgentInfo[] = [
      { ...agents[1], id: 'a2', status: 'error' },
      { ...agents[1], id: 'a3', status: 'error' },
    ];
    render(<AgentsPanel agents={troubled} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('2 agents need attention');
  });

  it('keeps the live region empty while all is quiet', () => {
    const calm: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() },
    ];
    render(<AgentsPanel agents={calm} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('AgentsPanel – folded groups and alarms', () => {
  it('marks a folded group that hides an agent needing a human', () => {
    const hidden: AgentInfo[] = [
      {
        ...agents[0],
        id: 'stuck',
        name: 'Stuck',
        status: 'running',
        lastActivityAt: Date.now() - 10 * 60_000,
        repoPath: '/work/api',
      },
    ];
    render(
      <AgentsPanel
        agents={hidden}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.getByTestId('repo-attention-dot')).toBeInTheDocument();
  });

  it('leaves a folded group unmarked while its agents are fine', () => {
    const calm: AgentInfo[] = [
      {
        ...agents[0],
        id: 'ok',
        status: 'running',
        lastActivityAt: Date.now(),
        repoPath: '/work/api',
      },
    ];
    render(
      <AgentsPanel
        agents={calm}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.queryByTestId('repo-attention-dot')).not.toBeInTheDocument();
  });

  it('needs no mark while the group is open — the cards speak for themselves', () => {
    const visible: AgentInfo[] = [
      {
        ...agents[0],
        id: 'stuck',
        name: 'Stuck',
        status: 'running',
        lastActivityAt: Date.now() - 10 * 60_000,
        repoPath: '/work/api',
      },
    ];
    render(
      <AgentsPanel
        agents={visible}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.queryByTestId('repo-attention-dot')).not.toBeInTheDocument();
  });
});

describe('AgentsPanel all-quiet signal', () => {
  it('says all quiet while agents work and none needs a human', () => {
    // The absence of alarms is not the same as permission to look away —
    // an explicit all-clear is what lets the user stop polling.
    const calm: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() },
    ];
    render(<AgentsPanel agents={calm} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.getByTestId('agents-all-quiet')).toHaveTextContent(/all quiet/i);
  });

  it('withdraws the all-clear the moment something needs attention', () => {
    const troubled: AgentInfo[] = [
      { ...agents[0], id: 'a1', status: 'running', lastActivityAt: Date.now() },
      { ...agents[1], id: 'a2', status: 'error' },
    ];
    render(<AgentsPanel agents={troubled} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agents-all-quiet')).not.toBeInTheDocument();
  });

  it('claims nothing while no agent is running', () => {
    // "All quiet" is a statement about work being watched; with nothing
    // running there is nothing to vouch for.
    const stopped: AgentInfo[] = [{ ...agents[1], id: 'a2', status: 'idle' }];
    render(<AgentsPanel agents={stopped} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agents-all-quiet')).not.toBeInTheDocument();
  });
});

describe('AgentsPanel – parked agents', () => {
  const parkedProps = {
    agents,
    onSpawn: vi.fn(),
    onKill: vi.fn(),
  };

  it('shows a minimize control on each card when parking is available', () => {
    // Only working agents get a card, and only cards can be parked.
    const working = agents.map((a) => ({ ...a, status: 'running' as const }));
    render(<AgentsPanel {...parkedProps} agents={working} onToggleMinimize={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Park agent' })).toHaveLength(2);
  });

  it('parking an agent reports it upward', async () => {
    const user = userEvent.setup();
    const onToggleMinimize = vi.fn();
    render(<AgentsPanel {...parkedProps} onToggleMinimize={onToggleMinimize} />);

    await user.click(screen.getAllByRole('button', { name: 'Park agent' })[0]);
    expect(onToggleMinimize).toHaveBeenCalledWith('agent-1', true);
  });

  it('renders a parked agent as a compact row instead of a card', () => {
    render(
      <AgentsPanel {...parkedProps} minimizedAgentIds={['agent-1']} onToggleMinimize={vi.fn()} />
    );
    const parked = screen.getByTestId('parked-agents');
    expect(parked).toHaveTextContent('Writer');
    // The card's objective text is what makes a card tall — a parked row drops it.
    expect(screen.queryByText('Writing docs')).not.toBeInTheDocument();
  });

  it('keeps unparked agents as full cards', () => {
    const working = agents.map((a) => ({ ...a, status: 'running' as const }));
    render(
      <AgentsPanel
        {...parkedProps}
        agents={working}
        minimizedAgentIds={['agent-1']}
        onToggleMinimize={vi.fn()}
      />
    );
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Park agent' })).toBeInTheDocument();
  });

  it('restores a parked agent', async () => {
    const user = userEvent.setup();
    const onToggleMinimize = vi.fn();
    render(
      <AgentsPanel
        {...parkedProps}
        minimizedAgentIds={['agent-1']}
        onToggleMinimize={onToggleMinimize}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Restore Writer' }));
    expect(onToggleMinimize).toHaveBeenCalledWith('agent-1', false);
  });

  it('says how many agents are parked', () => {
    render(
      <AgentsPanel {...parkedProps} minimizedAgentIds={['agent-1']} onToggleMinimize={vi.fn()} />
    );
    expect(screen.getByTestId('parked-agents')).toHaveTextContent('Parked · 1');
  });

  it('does not show a parked section when nothing is parked', () => {
    render(<AgentsPanel {...parkedProps} onToggleMinimize={vi.fn()} />);
    expect(screen.queryByTestId('parked-agents')).not.toBeInTheDocument();
  });

  it('still counts parked agents as running in the header', () => {
    render(
      <AgentsPanel {...parkedProps} minimizedAgentIds={['agent-1']} onToggleMinimize={vi.fn()} />
    );
    // Parking is a view state, not a lifecycle state — the agent keeps working.
    expect(screen.getByTestId('agents-running-count')).toHaveTextContent('1 running');
  });

  it('never claims "no agents" while agents are only parked', () => {
    render(
      <AgentsPanel
        {...parkedProps}
        minimizedAgentIds={['agent-1', 'agent-2']}
        onToggleMinimize={vi.fn()}
      />
    );
    expect(screen.queryByText('No agents running')).not.toBeInTheDocument();
    expect(screen.getByTestId('parked-agents')).toHaveTextContent('Writer');
  });
});

describe('AgentsPanel – finished agents', () => {
  const finishedAgent = {
    ...agents[1],
    id: 'agent-done',
    name: 'Reviewer',
    status: 'idle' as const,
  };
  const workingAgent = { ...agents[0], status: 'running' as const };

  it('folds a stopped agent into a compact list instead of a card', () => {
    render(
      <AgentsPanel agents={[workingAgent, finishedAgent]} onSpawn={vi.fn()} onKill={vi.fn()} />
    );

    expect(screen.getByTestId('finished-agents')).toHaveTextContent('Reviewer');
    // The card is what costs vertical space; its controls come with it.
    expect(screen.getAllByRole('button', { name: 'Show Terminal' })).toHaveLength(1);
  });

  it('says how many agents have finished', () => {
    render(
      <AgentsPanel agents={[workingAgent, finishedAgent]} onSpawn={vi.fn()} onKill={vi.fn()} />
    );
    expect(screen.getByTestId('finished-agents')).toHaveTextContent('Done · 1');
  });

  it('has no finished section while everything is still working', () => {
    render(<AgentsPanel agents={[workingAgent]} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByTestId('finished-agents')).not.toBeInTheDocument();
  });

  it('opens a finished agent to read its output', async () => {
    const user = userEvent.setup();
    const onSelectAgent = vi.fn();
    render(
      <AgentsPanel
        agents={[finishedAgent]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onSelectAgent={onSelectAgent}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open logs of Reviewer' }));
    expect(onSelectAgent).toHaveBeenCalledWith('agent-done');
  });

  it('dismisses a finished agent without going through kill', async () => {
    const user = userEvent.setup();
    const onDismissFinished = vi.fn();
    const onKill = vi.fn();
    render(
      <AgentsPanel
        agents={[finishedAgent]}
        onSpawn={vi.fn()}
        onKill={onKill}
        onDismissFinished={onDismissFinished}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss Reviewer' }));
    expect(onDismissFinished).toHaveBeenCalledWith('agent-done');
    expect(onKill).not.toHaveBeenCalled();
  });

  it('clears the whole finished list at once', async () => {
    const user = userEvent.setup();
    const onDismissFinished = vi.fn();
    render(
      <AgentsPanel
        agents={[finishedAgent, { ...finishedAgent, id: 'agent-done-2', name: 'Second' }]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={onDismissFinished}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onDismissFinished).toHaveBeenCalledTimes(2);
  });

  it('an unreviewed failure lives in the attention section, not in Done', () => {
    // One alarm, one place. Rendering it in both sections was the same
    // failure twice, with disagreeing unseen state.
    render(
      <AgentsPanel
        agents={[
          { ...finishedAgent, id: 'done-ok', name: 'Clean' },
          { ...finishedAgent, id: 'done-err', name: 'Broken', status: 'error' },
        ]}
        reviewedAgentIds={[]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={vi.fn()}
      />
    );

    expect(screen.getByTestId('attention-agents')).toHaveTextContent('Broken');
    expect(screen.getByTestId('finished-agents')).not.toHaveTextContent('Broken');
    expect(screen.getByTestId('finished-agents')).toHaveTextContent('Done · 1');
  });

  it('a reviewed failure migrates to Done and stops claiming attention', () => {
    // Opening the logs is the acknowledgement — the user owns the decision
    // now, and an alarm that cannot be quitted gets ignored.
    render(
      <AgentsPanel
        agents={[{ ...finishedAgent, id: 'done-err', name: 'Broken', status: 'error' }]}
        reviewedAgentIds={['done-err']}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={vi.fn()}
      />
    );

    expect(screen.queryByTestId('attention-agents')).not.toBeInTheDocument();
    expect(screen.getByTestId('finished-agents')).toHaveTextContent('Broken');
    expect(screen.queryByTestId('agents-attention-count')).not.toBeInTheDocument();
  });

  it('Clear keeps failures nobody has looked at', async () => {
    // Bulk-clearing must not silently discard an unreviewed failure — it is
    // not even in the Done list; it still sits in the attention section.
    const user = userEvent.setup();
    const onDismissFinished = vi.fn();
    render(
      <AgentsPanel
        agents={[
          { ...finishedAgent, id: 'done-ok', name: 'Clean' },
          { ...finishedAgent, id: 'done-ok-2', name: 'Clean Two' },
          { ...finishedAgent, id: 'done-err', name: 'Broken', status: 'error' },
        ]}
        reviewedAgentIds={[]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={onDismissFinished}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onDismissFinished).toHaveBeenCalledWith('done-ok');
    expect(onDismissFinished).toHaveBeenCalledWith('done-ok-2');
    expect(onDismissFinished).not.toHaveBeenCalledWith('done-err');
  });

  it('Clear takes a failure the user has reviewed', async () => {
    const user = userEvent.setup();
    const onDismissFinished = vi.fn();
    render(
      <AgentsPanel
        agents={[
          { ...finishedAgent, id: 'done-ok', name: 'Clean' },
          { ...finishedAgent, id: 'done-err', name: 'Broken', status: 'error' },
        ]}
        reviewedAgentIds={['done-err']}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={onDismissFinished}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onDismissFinished).toHaveBeenCalledWith('done-ok');
    expect(onDismissFinished).toHaveBeenCalledWith('done-err');
  });

  it('offers no Clear for a single finished agent', () => {
    render(
      <AgentsPanel
        agents={[finishedAgent]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});

describe('AgentsPanel – killing a single agent', () => {
  const working: AgentInfo = { ...agents[0], id: 'a1', name: 'Writer', status: 'running' };

  it('asks before ending a running agent', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={onKill} />);
    await user.click(screen.getByRole('button', { name: 'Terminate Agent' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onKill).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('names the agent in the question', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Terminate Agent' }));

    expect(confirmSpy.mock.calls[0][0]).toContain('Writer');
    confirmSpy.mockRestore();
  });

  it('kills once confirmed', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={onKill} />);
    await user.click(screen.getByRole('button', { name: 'Terminate Agent' }));

    expect(onKill).toHaveBeenCalledWith('a1');
    confirmSpy.mockRestore();
  });

  it('asks before ending a parked agent too', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <AgentsPanel
        agents={[working]}
        minimizedAgentIds={['a1']}
        onToggleMinimize={vi.fn()}
        onSpawn={vi.fn()}
        onKill={onKill}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Terminate Writer' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onKill).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('does not ask about an agent that has already stopped', async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const stopped: AgentInfo = { ...working, status: 'idle' };

    render(
      <AgentsPanel
        agents={[stopped]}
        minimizedAgentIds={['a1']}
        onToggleMinimize={vi.fn()}
        onSpawn={vi.fn()}
        onKill={onKill}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Terminate Writer' }));

    // There is no work left to lose, so a question would just be friction.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onKill).toHaveBeenCalledWith('a1');
    confirmSpy.mockRestore();
  });
});

describe('AgentsPanel – collapsible repo groups', () => {
  const repoAgents: AgentInfo[] = [
    { ...agents[0], id: 'a1', name: 'Writer', status: 'running', repoPath: '/work/api' },
    { ...agents[0], id: 'a2', name: 'Fixer', status: 'running', repoPath: '/work/api' },
  ];

  it('leaves the group header plain when folding is not offered', () => {
    render(<AgentsPanel agents={repoAgents} onSpawn={vi.fn()} onKill={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /collapse api/i })).not.toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('folds a group shut on click', async () => {
    const user = userEvent.setup();
    const onToggleRepoCollapsed = vi.fn();
    render(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onToggleRepoCollapsed={onToggleRepoCollapsed}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Collapse api' }));
    expect(onToggleRepoCollapsed).toHaveBeenCalledWith('/work/api');
  });

  it('hides the cards of a folded group', () => {
    render(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.queryByText('Writer')).not.toBeInTheDocument();
    expect(screen.queryByText('Fixer')).not.toBeInTheDocument();
  });

  it('says how many agents a folded group is hiding', () => {
    render(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    // Folding must not make agents feel gone.
    expect(screen.getByRole('button', { name: 'Expand api' })).toHaveTextContent('2');
  });

  it('reports its state to assistive technology', () => {
    const { rerender } = render(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Collapse api' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    rerender(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Expand api' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('keeps the running count honest while a group is folded', () => {
    render(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.getByTestId('agents-running-count')).toHaveTextContent('2 running');
  });

  it('still offers Kill All for a folded group', () => {
    render(
      <AgentsPanel
        agents={repoAgents}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onKillRepo={vi.fn()}
        collapsedRepos={['/work/api']}
        onToggleRepoCollapsed={vi.fn()}
      />
    );
    expect(screen.getByText('Kill All')).toBeInTheDocument();
  });
});

describe('AgentsPanel – colouring agents', () => {
  const working: AgentInfo = { ...agents[0], id: 'a1', name: 'Writer', status: 'running' };

  it('opens a colour menu on right-click', async () => {
    const user = userEvent.setup();
    render(
      <AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={vi.fn()} onSetColor={vi.fn()} />
    );

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Writer') });
    expect(screen.getByRole('menuitem', { name: 'Red' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Blue' })).toBeInTheDocument();
  });

  it('marks the agent with the chosen colour', async () => {
    const user = userEvent.setup();
    const onSetColor = vi.fn();
    render(
      <AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={vi.fn()} onSetColor={onSetColor} />
    );

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Writer') });
    await user.click(screen.getByRole('menuitem', { name: 'Green' }));

    expect(onSetColor).toHaveBeenCalledWith('a1', 'green');
  });

  it('offers no way to remove a marker the agent does not have', async () => {
    const user = userEvent.setup();
    render(
      <AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={vi.fn()} onSetColor={vi.fn()} />
    );

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Writer') });
    expect(screen.queryByRole('menuitem', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('removes an existing marker', async () => {
    const user = userEvent.setup();
    const onSetColor = vi.fn();
    render(
      <AgentsPanel
        agents={[working]}
        agentColors={{ a1: 'red' }}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onSetColor={onSetColor}
      />
    );

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Writer') });
    await user.click(screen.getByRole('menuitem', { name: /remove/i }));

    expect(onSetColor).toHaveBeenCalledWith('a1', null);
  });

  it('paints the card with the agent colour', () => {
    render(
      <AgentsPanel
        agents={[working]}
        agentColors={{ a1: 'red' }}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onSetColor={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-color-marker')).toHaveStyle({ backgroundColor: '#ff6b6b' });
  });

  it('keeps the marker on a parked agent', () => {
    render(
      <AgentsPanel
        agents={[working]}
        agentColors={{ a1: 'blue' }}
        minimizedAgentIds={['a1']}
        onToggleMinimize={vi.fn()}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onSetColor={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-color-marker')).toBeInTheDocument();
  });

  it('leaves right-click alone when colouring is not offered', async () => {
    const user = userEvent.setup();
    render(<AgentsPanel agents={[working]} onSpawn={vi.fn()} onKill={vi.fn()} />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Writer') });
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { AgentConsole } from './AgentConsole';
import { useStore } from '@/lib/store';

vi.mock('@/app/components/terminal/XtermTerminal', () => ({
  XtermTerminal: ({ agentId }: { agentId?: string }) => (
    <div data-testid="stage-terminal">{agentId}</div>
  ),
}));

const NOW = Date.now();

function agent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    id: 'agent',
    name: 'Agent',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    startedAt: NOW - 60_000,
    lastActivityAt: NOW - 500,
    ...overrides,
  };
}

function resetStore(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    agentConsoleOpen: false,
    agents: [],
    agentEvents: {},
    agentHeartbeat: {},
    reviewedAgentIds: [],
    agentColors: {},
    starredProjects: [],
    overlayStack: { layers: [] },
    ...overrides,
  } as Partial<ReturnType<typeof useStore.getState>>);
}

afterEach(() => {
  resetStore();
});

describe('AgentConsole', () => {
  it('renders nothing when closed', () => {
    resetStore({ agentConsoleOpen: false });
    const { container } = render(<AgentConsole onOpenTerminal={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an accessible dialog when open', () => {
    resetStore({ agentConsoleOpen: true });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /agent console/i })).toBeInTheDocument();
  });

  it('summarizes a mixed fleet correctly', () => {
    const agents: AgentInfo[] = [
      agent({ id: 'a1', repoPath: '/repos/acme-app' }),
      agent({ id: 'a2', repoPath: '/repos/other-app' }),
      agent({ id: 'a3', repoPath: '/repos/acme-app', awaitingInput: true }),
      agent({ id: 'a4', repoPath: '/repos/other-app', status: 'error' }),
      agent({ id: 'a5', repoPath: '/repos/acme-app', status: 'idle' }),
    ];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    // "Running" counts by process status, same predicate as ProjectSection's
    // own count — a3 is waiting on a permission prompt, but its process is
    // still running. Undercounting it here is what made the header read "0
    // running … 3 need you" while every section still said "3 running".
    expect(screen.getByTestId('agent-console-summary')).toHaveTextContent(
      '3 running across 2 projects · 2 need you · 1 done, unreviewed'
    );
    expect(screen.getByTestId('agent-console-attention-badge')).toHaveTextContent('2 need you');
  });

  it("agrees with the sum of every section's own running count", () => {
    // Three agents at a permission prompt is exactly the scenario that broke:
    // every one of them is "running" by status, none is in the 'working'
    // console bucket.
    const agents: AgentInfo[] = [
      agent({ id: 'p1', repoPath: '/repos/acme-app', awaitingInput: true }),
      agent({ id: 'p2', repoPath: '/repos/acme-app', awaitingInput: true }),
      agent({ id: 'p3', repoPath: '/repos/other-app', awaitingInput: true }),
    ];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    expect(screen.getByTestId('agent-console-summary')).toHaveTextContent(/^3 running/);
    const sectionRunningCounts = screen
      .getAllByTestId(/^project-section-\/repos\//)
      .map((section) => Number(/(\d+) running/.exec(section.textContent ?? '')?.[1] ?? 0));
    expect(sectionRunningCounts.reduce((sum, n) => sum + n, 0)).toBe(3);
  });

  it('shows "All clear" when nothing needs the user', () => {
    resetStore({
      agentConsoleOpen: true,
      agents: [agent({ id: 'a1', repoPath: '/repos/acme-app' })],
    });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);
    expect(screen.getByTestId('agent-console-attention-badge')).toHaveTextContent('All clear');
  });

  it('closes on Escape', () => {
    resetStore({ agentConsoleOpen: true });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useStore.getState().agentConsoleOpen).toBe(false);
  });

  it('sorts a project needing attention ahead of a calm one', () => {
    const agents: AgentInfo[] = [
      agent({ id: 'calm-1', repoPath: '/repos/calm-app' }),
      agent({ id: 'yours-1', repoPath: '/repos/urgent-app', awaitingInput: true }),
    ];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    const sections = screen.getAllByTestId(/^project-section-\/repos\//);
    expect(sections[0].dataset.testid).toBe('project-section-/repos/urgent-app');
    expect(sections[1].dataset.testid).toBe('project-section-/repos/calm-app');
  });

  it('shows a centred empty state with a Start agent button when there is nothing at all', async () => {
    const user = userEvent.setup();
    resetStore({ agentConsoleOpen: true, agents: [], starredProjects: [] });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    expect(screen.getByTestId('agent-console-empty')).toHaveTextContent('No agents running');
    expect(
      screen.getByText("Start an agent from a project's context menu or the Agents panel.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start agent' }));
    expect(useStore.getState().spawnDialogOpen).toBe(true);
  });

  it('keeps the idle row (with its own hint) instead of the empty state when idle projects exist', () => {
    const starredProjects: StarredProject[] = [
      { path: '/repos/idle-app', name: 'idle-app', starredAt: 0 },
    ];
    resetStore({ agentConsoleOpen: true, agents: [], starredProjects });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    expect(screen.queryByTestId('agent-console-empty')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No agents running' })).toBeInTheDocument();
    expect(screen.getByTestId('project-section-/repos/idle-app')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start agent' })).not.toBeInTheDocument();
  });

  it('lists starred projects with no running agents as idle', () => {
    const starredProjects: StarredProject[] = [
      { path: '/repos/idle-app', name: 'idle-app', starredAt: 0 },
    ];
    resetStore({ agentConsoleOpen: true, agents: [], starredProjects });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    const section = screen.getByTestId('project-section-/repos/idle-app');
    expect(section).toHaveTextContent('idle');
  });
});

describe('AgentConsole focus view', () => {
  it('shows the focus view for an agent and hides the project grid', async () => {
    const user = userEvent.setup();
    const agents: AgentInfo[] = [agent({ id: 'a1', repoPath: '/repos/acme-app' })];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Focus' }));

    expect(screen.getByTestId('focus-view')).toBeInTheDocument();
    expect(screen.queryByTestId('project-section-/repos/acme-app')).not.toBeInTheDocument();
  });

  it('returns to the grid when the back button is clicked', async () => {
    const user = userEvent.setup();
    const agents: AgentInfo[] = [agent({ id: 'a1', repoPath: '/repos/acme-app' })];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await user.click(screen.getByRole('button', { name: '← Projects' }));

    expect(screen.queryByTestId('focus-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-section-/repos/acme-app')).toBeInTheDocument();
  });

  it('Esc returns to the grid first, and only closes the console on a second Esc', async () => {
    const user = userEvent.setup();
    const agents: AgentInfo[] = [agent({ id: 'a1', repoPath: '/repos/acme-app' })];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByTestId('focus-view')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('focus-view')).not.toBeInTheDocument();
    expect(useStore.getState().agentConsoleOpen).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().agentConsoleOpen).toBe(false);
  });

  it('switches focus from one agent to another via the other-agents rail', async () => {
    const user = userEvent.setup();
    const agents: AgentInfo[] = [
      agent({ id: 'a1', name: 'First agent', repoPath: '/repos/acme-app' }),
      agent({ id: 'a2', name: 'Second agent', repoPath: '/repos/acme-app' }),
    ];
    resetStore({ agentConsoleOpen: true, agents });
    render(<AgentConsole onOpenTerminal={vi.fn()} />);

    await user.click(screen.getAllByRole('button', { name: 'Focus' })[0]);
    expect(screen.getByTestId('stage-terminal')).toHaveTextContent('a1');

    await user.click(screen.getByTestId('focus-thumb-a2'));
    expect(screen.getByTestId('stage-terminal')).toHaveTextContent('a2');
  });
});

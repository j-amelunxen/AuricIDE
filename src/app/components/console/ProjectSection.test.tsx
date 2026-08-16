import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { ProjectSection } from './ProjectSection';
import { useStore } from '@/lib/store';

const NOW = Date.now();

function agent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    id: 'a1',
    name: 'Agent',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    startedAt: NOW - 60_000,
    lastActivityAt: NOW - 500,
    repoPath: '/repos/acme-app',
    ...overrides,
  };
}

function resetStore() {
  useStore.setState({
    starredProjects: [],
    agents: [],
  } as Partial<ReturnType<typeof useStore.getState>>);
}

function baseProps(overrides: Partial<React.ComponentProps<typeof ProjectSection>> = {}) {
  return {
    repoPath: '/repos/acme-app',
    agents: [agent({ id: 'a1' })],
    agentEvents: {},
    agentHeartbeat: {},
    heartbeatScaleMax: 1,
    reviewedAgentIds: [] as string[],
    onOpenTerminal: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onMarkReviewed: vi.fn(),
    onDismiss: vi.fn(),
    onStopAll: vi.fn(),
    ...overrides,
  };
}

describe('ProjectSection header', () => {
  it('shows the repo basename and a running count', () => {
    resetStore();
    render(<ProjectSection {...baseProps()} />);
    expect(screen.getByText('acme-app')).toBeInTheDocument();
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
  });

  it('adds an unreviewed-finish count once one exists', () => {
    resetStore();
    render(
      <ProjectSection
        {...baseProps({
          agents: [agent({ id: 'a1' }), agent({ id: 'a2', status: 'idle' })],
        })}
      />
    );
    expect(screen.getByText(/1 done, unreviewed/)).toBeInTheDocument();
  });

  it('flags the section when an agent needs attention', () => {
    resetStore();
    const { container } = render(
      <ProjectSection {...baseProps({ agents: [agent({ id: 'a1', awaitingInput: true })] })} />
    );
    expect(container.querySelector('[data-needs-attention="true"]')).toBeInTheDocument();
  });

  it('does not flag the section when every agent is calm', () => {
    resetStore();
    const { container } = render(<ProjectSection {...baseProps()} />);
    expect(container.querySelector('[data-needs-attention="true"]')).not.toBeInTheDocument();
  });
});

describe('ProjectSection header icon', () => {
  it('renders the project’s configured icon override, matching Quick Access', () => {
    resetStore();
    useStore.setState({
      starredProjects: [
        {
          path: '/repos/acme-app',
          name: 'acme-app',
          starredAt: NOW,
          icon: { kind: 'emoji', value: '🚀' },
        },
      ],
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ProjectSection {...baseProps()} />);

    const tile = screen.getByTestId('tile-face-/repos/acme-app');
    expect(tile).toHaveAttribute('data-icon-kind', 'emoji');
    expect(tile).toHaveTextContent('🚀');
  });
});

describe('ProjectSection ordering', () => {
  it('sorts waiting-on-you ahead of a plain running agent', () => {
    resetStore();
    render(
      <ProjectSection
        {...baseProps({
          agents: [
            agent({ id: 'running-1', name: 'Running One' }),
            agent({ id: 'yours-1', name: 'Yours One', awaitingInput: true }),
          ],
        })}
      />
    );
    const names = screen.getAllByTestId(/^console-agent-card-/).map((el) => el.textContent);
    expect(names[0]).toContain('Yours One');
    expect(names[1]).toContain('Running One');
  });
});

describe('ProjectSection actions', () => {
  it('Spawn agent opens the spawn dialog targeting this repo', async () => {
    resetStore();
    const user = userEvent.setup();
    render(<ProjectSection {...baseProps()} />);

    await user.click(screen.getByRole('button', { name: 'Spawn agent' }));

    expect(useStore.getState().spawnDialogOpen).toBe(true);
    expect(useStore.getState().spawnAgentRepoPath).toBe('/repos/acme-app');
  });

  it('does not offer Stop all for an idle project — nothing running to confirm stopping', () => {
    resetStore();
    render(<ProjectSection {...baseProps({ agents: [] })} />);
    expect(screen.queryByRole('button', { name: 'Stop all' })).not.toBeInTheDocument();
  });

  it('Stop all asks for confirmation before calling onStopAll', async () => {
    resetStore();
    const user = userEvent.setup();
    const onStopAll = vi.fn();
    render(<ProjectSection {...baseProps({ onStopAll })} />);

    await user.click(screen.getByRole('button', { name: 'Stop all' }));
    expect(onStopAll).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Stop all' }));
    expect(onStopAll).toHaveBeenCalledWith('/repos/acme-app');
  });
});

describe('ProjectSection keyboard access', () => {
  it('reveals its actions on keyboard focus, not just on hover', () => {
    // The actions are hover-revealed (`opacity-0`). Without a focus-within
    // rule a keyboard user tabs onto a button they cannot see.
    resetStore();
    render(<ProjectSection {...baseProps()} />);

    const actions = screen.getByTestId('project-section-actions');
    expect(actions.className).toContain('group-focus-within:opacity-100');
  });

  it('opens the spawn menu from the keyboard with the context-menu key', async () => {
    resetStore();
    render(<ProjectSection {...baseProps()} />);

    const section = screen.getByTestId('project-section-/repos/acme-app');
    fireEvent.keyDown(section, { key: 'ContextMenu' });

    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('opens the spawn menu with Shift+F10 as well', async () => {
    resetStore();
    render(<ProjectSection {...baseProps()} />);

    const section = screen.getByTestId('project-section-/repos/acme-app');
    fireEvent.keyDown(section, { key: 'F10', shiftKey: true });

    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { FleetTreemap } from './FleetTreemap';

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

function resetStore() {
  useStore.setState({
    starredProjects: [],
    agents: [],
  } as Partial<ReturnType<typeof useStore.getState>>);
}

afterEach(() => {
  resetStore();
});

function renderTreemap(agents: AgentInfo[], onFocus = vi.fn()) {
  const grouped = new Map<string, AgentInfo[]>();
  for (const item of agents) {
    const path = item.repoPath ?? '';
    const list = grouped.get(path) ?? [];
    list.push(item);
    grouped.set(path, list);
  }
  const groups = [...grouped.entries()].map(([repoPath, list]) => ({
    repoPath,
    agents: list,
  }));
  return render(
    <div style={{ width: 800, height: 400 }}>
      <FleetTreemap
        groups={groups}
        agentEvents={{}}
        agentHeartbeat={{}}
        heartbeatScaleMax={1}
        reviewedAgentIds={[]}
        onFocus={onFocus}
        onOpenTerminal={vi.fn()}
        onStop={vi.fn()}
        onRetry={vi.fn()}
        onMarkReviewed={vi.fn()}
        onDismiss={vi.fn()}
        onStopAll={vi.fn()}
      />
    </div>
  );
}

describe('FleetTreemap', () => {
  it('renders one cluster per project and one cell per agent', () => {
    resetStore();
    renderTreemap([
      agent({ id: 'c1', name: 'One', repoPath: '/repos/customers' }),
      agent({ id: 'c2', name: 'Two', repoPath: '/repos/customers' }),
      agent({ id: 'w1', name: 'Site', repoPath: '/repos/website' }),
    ]);

    expect(screen.getByTestId('project-section-/repos/customers')).toBeInTheDocument();
    expect(screen.getByTestId('project-section-/repos/website')).toBeInTheDocument();
    expect(screen.getByTestId('console-agent-card-c1')).toBeInTheDocument();
    expect(screen.getByTestId('console-agent-card-c2')).toBeInTheDocument();
    expect(screen.getByTestId('console-agent-card-w1')).toBeInTheDocument();
  });

  it('gives the busier project a larger cluster than a one-agent project', () => {
    resetStore();
    renderTreemap([
      agent({ id: 'c1', repoPath: '/repos/customers' }),
      agent({ id: 'c2', repoPath: '/repos/customers' }),
      agent({ id: 'c3', repoPath: '/repos/customers' }),
      agent({ id: 'c4', repoPath: '/repos/customers' }),
      agent({ id: 'w1', repoPath: '/repos/website' }),
    ]);

    const customers = screen.getByTestId('project-section-/repos/customers');
    const website = screen.getByTestId('project-section-/repos/website');
    const customersArea =
      Number.parseFloat(customers.style.width) * Number.parseFloat(customers.style.height);
    const websiteArea =
      Number.parseFloat(website.style.width) * Number.parseFloat(website.style.height);
    expect(customersArea).toBeGreaterThan(websiteArea * 2);
  });

  it('does not scroll — the map fills its parent', () => {
    resetStore();
    renderTreemap([agent({ id: 'a1', repoPath: '/repos/acme-app' })]);
    expect(screen.getByTestId('fleet-treemap').className).toContain('overflow-hidden');
  });

  it('focuses an agent when its cell is clicked', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    resetStore();
    renderTreemap([agent({ id: 'a1', name: 'Waitlist', repoPath: '/repos/acme-app' })], onFocus);

    await user.click(screen.getByTestId('console-agent-card-a1'));
    expect(onFocus).toHaveBeenCalledWith('a1');
  });

  it('keeps a Focus button so the existing console shortcut still has a target', () => {
    resetStore();
    renderTreemap([agent({ id: 'a1', repoPath: '/repos/acme-app' })]);
    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
  });
});

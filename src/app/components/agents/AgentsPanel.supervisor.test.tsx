import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { forgetSupervisorRunResults, type AgentInfo } from '@/lib/tauri/agents';
import { AgentsPanel } from './AgentsPanel';

vi.mock('@/lib/tauri/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/agents')>()),
  forgetSupervisorRunResults: vi.fn(async () => 0),
}));

const agent = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: id,
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 1,
  ...extra,
});

const SUPERVISOR = agent('sup', {
  name: 'Supervisor',
  role: 'supervisor',
  repoPath: '/app-data/supervisor',
});
const CHILD = agent('child', { spawnedByAgentId: 'sup', repoPath: '/work/project-a' });
const WORKER = agent('worker', { repoPath: '/work/project-a' });

describe('AgentsPanel — supervisors', () => {
  beforeEach(() => {
    vi.mocked(forgetSupervisorRunResults).mockClear();
  });

  it('puts supervisors in their own group above the projects, never under a folder name', () => {
    render(
      <AgentsPanel
        agents={[WORKER, CHILD, SUPERVISOR]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onKillRepo={vi.fn()}
      />
    );
    const groups = screen.getAllByTestId(/^agent-group-/);
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
      'agent-group-supervisor',
      'agent-group-/work/project-a',
    ]);
    expect(groups[0].firstElementChild).toHaveTextContent(/^SupervisorStop all$/);
    expect(screen.queryByText('supervisor', { exact: true })).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
    // The child stays with its project, pointing back at the supervisor.
    expect(within(groups[1]).getByTestId('agent-supervisor-link')).toBeInTheDocument();
  });

  it("asks before the group's Stop all and then stops only the supervisors", async () => {
    const user = userEvent.setup();
    const onKill = vi.fn();
    const onKillRepo = vi.fn();
    render(
      <AgentsPanel
        agents={[WORKER, SUPERVISOR]}
        onSpawn={vi.fn()}
        onKill={onKill}
        onKillRepo={onKillRepo}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Stop all agents in Supervisor' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Stop 1 running agent in Supervisor?');
    expect(onKill).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Stop all' }));
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(onKill).toHaveBeenCalledWith('sup');
    expect(onKillRepo).not.toHaveBeenCalled();
  });

  it("does not count the supervisor in its folder's Stop all", async () => {
    const user = userEvent.setup();
    render(
      <AgentsPanel
        agents={[WORKER, agent('other', { repoPath: '/work/project-a' }), SUPERVISOR]}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onKillRepo={vi.fn()}
      />
    );
    expect(screen.getByTestId('agents-panel')).toHaveTextContent('3 running');
    await user.click(screen.getByRole('button', { name: 'Stop all agents in project-a' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Stop 2 running agents in project-a?'
    );
  });

  it("bulk Clear forgets a cleared supervisor's results", async () => {
    const user = userEvent.setup();
    const stopped = [
      agent('sup-done', { role: 'supervisor', status: 'idle', finishedAt: 5 }),
      agent('plain-done', { status: 'idle', finishedAt: 4 }),
    ];
    useStore.setState({ agents: stopped, reviewedAgentIds: [] });
    render(
      <AgentsPanel
        agents={stopped}
        onSpawn={vi.fn()}
        onKill={vi.fn()}
        onDismissFinished={useStore.getState().dismissFinishedAgent}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useStore.getState().agents).toEqual([]);
    expect(forgetSupervisorRunResults).toHaveBeenCalledTimes(1);
    expect(forgetSupervisorRunResults).toHaveBeenCalledWith('sup-done');
  });
});

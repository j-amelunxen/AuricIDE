import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { SupervisorRunsPanel } from './SupervisorRunsPanel';

const { supervisorRunsList, supervisorRunFiles } = vi.hoisted(() => ({
  supervisorRunsList: vi.fn(),
  supervisorRunFiles: vi.fn(),
}));
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList, supervisorRunFiles }));

const RUN = {
  name: '2026-10-16_185017',
  path: '/home/me/.auric/supervisors/2026-10-16_185017',
  modifiedAtMs: Date.now() - 2 * 3600_000,
  fileCount: 3,
  truncated: false,
};

const OTHER = {
  ...RUN,
  name: '2026-10-15_090000',
  path: '/home/me/.auric/supervisors/2026-10-15_090000',
};

const supervisor: AgentInfo = {
  id: 'sup-1',
  name: 'Supervisor',
  model: 'sonnet',
  provider: 'claude',
  status: 'running',
  startedAt: 1,
  role: 'supervisor',
};

describe('SupervisorRunsPanel', () => {
  beforeEach(() => {
    supervisorRunsList.mockReset().mockResolvedValue([RUN]);
    supervisorRunFiles.mockReset().mockResolvedValue([
      { relativePath: 'notes.md', path: `${RUN.path}/notes.md`, size: 1, modifiedAtMs: 10 },
      {
        relativePath: 'frames/a.png',
        path: `${RUN.path}/frames/a.png`,
        size: 1,
        modifiedAtMs: 20,
      },
    ]);
    useStore.setState({ agents: [], toasts: [] });
  });

  it('lists runs with when they last changed and unfolds one into its files', async () => {
    const onOpenFile = vi.fn();
    render(<SupervisorRunsPanel onOpenFile={onOpenFile} onSelectAgent={vi.fn()} />);

    expect(await screen.findByText('Oct 16, 18:50')).toBeInTheDocument();
    expect(screen.getByText('2h 0m ago · 3 files')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Oct 16, 18:50/ }));
    const folder = await screen.findByRole('button', { name: 'frames' });
    expect(supervisorRunFiles).toHaveBeenCalledWith(RUN.path);
    expect(screen.queryByRole('button', { name: 'a.png' })).toBeNull();

    fireEvent.click(folder);
    fireEvent.click(screen.getByRole('button', { name: 'a.png' }));
    expect(onOpenFile).toHaveBeenCalledWith(`${RUN.path}/frames/a.png`);
  });

  it('resumes a run in its folder and shows the new supervisor', async () => {
    const spawnSupervisor = vi.fn(async () => ({ kind: 'spawned' as const, agent: supervisor }));
    useStore.setState({ spawnSupervisor });
    const onSelectAgent = vi.fn();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={onSelectAgent} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Resume supervisor run Oct 16, 18:50' })
    );

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-1'));
    expect(spawnSupervisor).toHaveBeenCalledWith({ task: '', resumeRunDir: RUN.path });
  });

  it('lets a run be resumed while a supervisor runs in another folder', async () => {
    useStore.setState({
      agents: [{ ...supervisor, repoPath: '/home/me/.auric/supervisors/2026-10-20_080000' }],
    });
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    const resume = await screen.findByRole('button', {
      name: 'Resume supervisor run Oct 16, 18:50',
    });
    expect(resume).toBeEnabled();
  });

  it('offers to show the supervisor a run is live in, rather than a resume that cannot start', async () => {
    const onSelectAgent = vi.fn();
    useStore.setState({
      agents: [{ ...supervisor, supervisorKey: 'mail-triage', repoPath: `${RUN.path}/` }],
    });
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={onSelectAgent} />);

    expect(await screen.findByText('Running in mail-triage')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resume supervisor run Oct 16, 18:50' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show mail-triage' }));
    expect(onSelectAgent).toHaveBeenCalledWith('sup-1');
  });

  it('shows how long ago each file changed', async () => {
    supervisorRunFiles.mockResolvedValue([
      {
        relativePath: 'notes.md',
        path: `${RUN.path}/notes.md`,
        size: 1,
        modifiedAtMs: Date.now() - 5 * 60_000,
      },
    ]);
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Oct 16, 18:50/ }));
    expect(await screen.findByRole('button', { name: /^notes\.md/ })).toHaveTextContent('5m');
  });

  it('keeps several runs open at once', async () => {
    supervisorRunsList.mockResolvedValue([RUN, OTHER]);
    supervisorRunFiles.mockImplementation(async (path: string) => [
      {
        relativePath: path === RUN.path ? 'a.md' : 'b.md',
        path: `${path}/x.md`,
        size: 1,
        modifiedAtMs: 1,
      },
    ]);
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Oct 16, 18:50/ }));
    await screen.findByRole('button', { name: /^a\.md/ });
    fireEvent.click(screen.getByRole('button', { name: /^Oct 15, 09:00/ }));
    await screen.findByRole('button', { name: /^b\.md/ });
    expect(screen.getByRole('button', { name: /^a\.md/ })).toBeInTheDocument();
  });

  it('offers to try again when the runs cannot be read', async () => {
    supervisorRunsList.mockRejectedValueOnce(new Error('permission denied'));
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Oct 16, 18:50')).toBeInTheDocument();
  });

  it('reads the runs again when the window comes back into focus', async () => {
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    await screen.findByText('Oct 16, 18:50');
    supervisorRunsList.mockResolvedValue([OTHER, RUN]);
    fireEvent.focus(window);
    expect(await screen.findByText('Oct 15, 09:00')).toBeInTheDocument();
  });

  it('says so when no supervisor has run yet', async () => {
    supervisorRunsList.mockResolvedValue([]);
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    expect(await screen.findByText(/No supervisor has run yet/)).toBeInTheDocument();
  });
});

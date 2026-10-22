import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { SupervisorRunsPanel } from './SupervisorRunsPanel';

const {
  supervisorRunsList,
  supervisorRunFiles,
  managerRegistry,
  managerPromote,
  managerRename,
  managerArchive,
  managerRestore,
  managerRemove,
  managerInstructions,
  managerMemory,
  managerValidate,
  machineDependencies,
  revealInFileManager,
} = vi.hoisted(() => ({
  supervisorRunsList: vi.fn(),
  supervisorRunFiles: vi.fn(),
  managerRegistry: vi.fn(),
  managerPromote: vi.fn(),
  managerRename: vi.fn(),
  managerArchive: vi.fn(),
  managerRestore: vi.fn(),
  managerRemove: vi.fn(),
  managerInstructions: vi.fn(),
  managerMemory: vi.fn(),
  managerValidate: vi.fn(),
  machineDependencies: vi.fn(),
  revealInFileManager: vi.fn(),
}));
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList, supervisorRunFiles }));
vi.mock('@/lib/tauri/supervisorManagers', () => ({
  managerRegistry,
  managerPromote,
  managerRename,
  managerArchive,
  managerRestore,
  managerRemove,
  managerInstructions,
  managerMemory,
  managerValidate,
}));
vi.mock('@/lib/tauri/machine', () => ({ machineDependencies }));
vi.mock('@/lib/tauri/opener', () => ({ revealInFileManager }));

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
    managerRegistry.mockReset().mockResolvedValue({ managers: [], error: null });
    machineDependencies.mockReset().mockResolvedValue([]);
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

const ROOT = '/home/me/.auric/supervisors';

const desk: SupervisorManager = {
  key: 'release-desk',
  name: 'Release Desk',
  runDir: '2026-10-21_090000',
  promotedAt: '2026-10-22T10:15:00Z',
  archivedAt: null,
  lastLaunch: null,
};
const triage = { ...desk, key: 'inbox-triage', name: 'Inbox Triage', runDir: '2026-10-20_080000' };
const oldDesk = {
  ...desk,
  key: 'old-desk',
  name: 'Old Desk',
  runDir: '2026-10-01_080000',
  archivedAt: '2026-10-10T00:00:00Z',
};

const runOf = (manager: SupervisorManager) => ({
  ...RUN,
  name: manager.runDir,
  path: `${ROOT}/${manager.runDir}`,
  manager: { key: manager.key, name: manager.name, archivedAt: manager.archivedAt },
});

const withManagers = (registryError: string | null = null) => {
  const managers = [desk, triage, oldDesk];
  supervisorRunsList.mockResolvedValue([runOf(triage), RUN, runOf(desk), runOf(oldDesk)]);
  managerRegistry.mockResolvedValue({ managers, error: registryError });
};

const rowMenu = async (name: string | RegExp) => {
  fireEvent.contextMenu(await screen.findByRole('button', { name }));
  return screen.getByRole('menu');
};

describe('SupervisorRunsPanel: Project Managers', () => {
  beforeEach(() => {
    supervisorRunFiles.mockReset().mockResolvedValue([]);
    managerPromote.mockReset().mockResolvedValue({ ...desk, key: 'fresh-one', name: 'Fresh One' });
    managerRename.mockReset().mockResolvedValue(desk);
    managerArchive.mockReset().mockResolvedValue(desk);
    managerRestore.mockReset().mockResolvedValue(desk);
    managerRemove.mockReset().mockResolvedValue(undefined);
    managerInstructions.mockReset().mockResolvedValue('- Be brief.');
    managerMemory.mockReset().mockResolvedValue({
      concepts: { Fact: 2 },
      deprecated: 0,
      newestChangeMs: 1,
      findings: [],
      okf: 'ok',
      checkedAt: '2026-10-22T11:00:00Z',
    });
    managerValidate.mockReset().mockResolvedValue({
      concepts: { Fact: 2 },
      deprecated: 0,
      newestChangeMs: 1,
      findings: [],
      okf: 'ok',
      checkedAt: '2026-10-22T12:00:00Z',
    });
    revealInFileManager.mockReset().mockResolvedValue(undefined);
    machineDependencies.mockReset().mockResolvedValue([]);
    managerRegistry.mockReset().mockResolvedValue({ managers: [], error: null });
    supervisorRunsList.mockReset().mockResolvedValue([RUN]);
    useStore.setState({ agents: [], toasts: [] });
  });

  it('pins managers by name above the recent runs, and keeps their folders out of the runs', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    expect(await screen.findByText('Project Managers')).toBeInTheDocument();
    expect(screen.getByText('Recent Runs')).toBeInTheDocument();
    const names = screen.getAllByTestId('manager-row').map((row) => row.textContent);
    expect(names[0]).toContain('Inbox Triage');
    expect(names[1]).toContain('Release Desk');
    expect(screen.getAllByTestId('run-row')).toHaveLength(1);
  });

  it('shows no section titles while there are no managers', async () => {
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    await screen.findByText('Oct 16, 18:50');
    expect(screen.queryByText('Project Managers')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Runs')).not.toBeInTheDocument();
  });

  it('marks a running manager and keeps archived ones folded until asked', async () => {
    withManagers();
    useStore.setState({
      agents: [
        { ...supervisor, supervisorKey: 'release-desk', repoPath: `${ROOT}/${desk.runDir}` },
      ],
    });
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Old Desk')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByText('Old Desk')).toBeInTheDocument();
  });

  it('offers to promote a run from its context menu and from the hover button', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    const menu = await rowMenu(/^Oct 16, 18:50/);
    expect(
      within(menu).getByRole('menuitem', { name: 'Promote to Project Manager…' })
    ).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Oct 16, 18:50' }));
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Promote to Project Manager…',
      })
    ).toBeVisible();
  });

  it('promotes a run, refreshes, and unfolds the new manager', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    const menu = await rowMenu(/^Oct 16, 18:50/);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Promote to Project Manager…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Fresh One' },
    });
    managerRegistry.mockResolvedValue({
      managers: [
        desk,
        triage,
        oldDesk,
        { ...desk, key: 'fresh-one', name: 'Fresh One', runDir: RUN.name },
      ],
      error: null,
    });
    supervisorRunsList.mockResolvedValue([
      runOf(triage),
      runOf(desk),
      runOf(oldDesk),
      { ...RUN, manager: { key: 'fresh-one', name: 'Fresh One', archivedAt: null } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(managerPromote).toHaveBeenCalledWith(RUN.name, 'Fresh One'));
    expect(await screen.findByText('fresh-one')).toBeInTheDocument();
    expect(useStore.getState().toasts.at(-1)?.message).toContain('Fresh One');
  });

  it('offers a manager Open, Edit Instructions, Rename, Show in Finder, Validate and Archive', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    const menu = await rowMenu(/^Release Desk/);
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(labels).toEqual([
      'Open',
      'Edit Instructions…',
      'Rename…',
      'Show in Finder',
      'Validate Memory',
      'Archive…',
    ]);
  });

  it('opens a manager by key', async () => {
    withManagers();
    const spawnSupervisor = vi.fn(async () => ({ kind: 'spawned' as const, agent: supervisor }));
    useStore.setState({ spawnSupervisor });
    const onSelectAgent = vi.fn();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={onSelectAgent} />);
    fireEvent.click(within(await rowMenu(/^Release Desk/)).getByRole('menuitem', { name: 'Open' }));
    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-1'));
    expect(spawnSupervisor).toHaveBeenCalledWith({ task: '', managerKey: 'release-desk' });
  });

  it('opens the instructions file of a manager in the editor', async () => {
    withManagers();
    const onOpenFile = vi.fn();
    render(<SupervisorRunsPanel onOpenFile={onOpenFile} onSelectAgent={vi.fn()} />);
    fireEvent.click(
      within(await rowMenu(/^Release Desk/)).getByRole('menuitem', { name: 'Edit Instructions…' })
    );
    expect(onOpenFile).toHaveBeenCalledWith(`${ROOT}/${desk.runDir}/INSTRUCTIONS.md`);
  });

  it('reveals the folder in Finder', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(
      within(await rowMenu(/^Release Desk/)).getByRole('menuitem', { name: 'Show in Finder' })
    );
    expect(revealInFileManager).toHaveBeenCalledWith(`${ROOT}/${desk.runDir}`);
  });

  it('validates the memory and says what it found', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(
      within(await rowMenu(/^Release Desk/)).getByRole('menuitem', { name: 'Validate Memory' })
    );
    await waitFor(() => expect(managerValidate).toHaveBeenCalledWith('release-desk'));
    await waitFor(() =>
      expect(useStore.getState().toasts.at(-1)?.message).toBe(
        'Release Desk: memory has no problems.'
      )
    );
  });

  it('renames a manager through the sheet', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(
      within(await rowMenu(/^Release Desk/)).getByRole('menuitem', { name: 'Rename…' })
    );
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field).toHaveValue('Release Desk');
    fireEvent.change(field, { target: { value: 'Launch Desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(managerRename).toHaveBeenCalledWith('release-desk', 'Launch Desk'));
  });

  it('archives only after a confirmation', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(
      within(await rowMenu(/^Release Desk/)).getByRole('menuitem', { name: 'Archive…' })
    );
    expect(managerArchive).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(managerArchive).toHaveBeenCalledWith('release-desk'));
  });

  it('restores an archived manager and removes one only after a confirmation', async () => {
    withManagers();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    await screen.findByText('Project Managers');
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    const labels = () =>
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent);

    fireEvent.contextMenu(screen.getByRole('button', { name: /^Old Desk/ }));
    expect(labels()).toEqual(['Restore', 'Remove Project Manager…']);
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(managerRestore).toHaveBeenCalledWith('old-desk'));

    fireEvent.contextMenu(screen.getByRole('button', { name: /^Old Desk/ }));
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Remove Project Manager…' })
    );
    expect(managerRemove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(managerRemove).toHaveBeenCalledWith('old-desk'));
  });

  it('turns every change off, with the reason in the menu, when the registry cannot be read', async () => {
    withManagers('supervisor-managers.json could not be read: bad. It was left as it is.');
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    const menu = await rowMenu(/^Release Desk/);
    expect(within(menu).getByRole('menuitem', { name: 'Archive…' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(menu).getAllByText(/could not be read/).length).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    const runMenu = await rowMenu(/^Oct 16, 18:50/);
    expect(
      within(runMenu).getByRole('menuitem', { name: 'Promote to Project Manager…' })
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('restarts a running manager after a confirmation: ends the session, then opens it again', async () => {
    withManagers();
    const killRunningAgent = vi.fn(async () => undefined);
    const spawnSupervisor = vi.fn(async () => ({ kind: 'spawned' as const, agent: supervisor }));
    useStore.setState({
      killRunningAgent,
      spawnSupervisor,
      agents: [
        { ...supervisor, supervisorKey: 'release-desk', repoPath: `${ROOT}/${desk.runDir}` },
      ],
    });
    const onSelectAgent = vi.fn();
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={onSelectAgent} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Release Desk/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart Now' }));
    expect(killRunningAgent).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(killRunningAgent).toHaveBeenCalledWith('sup-1'));
    await waitFor(() =>
      expect(spawnSupervisor).toHaveBeenCalledWith({ task: '', managerKey: 'release-desk' })
    );
    expect(killRunningAgent.mock.invocationCallOrder[0]).toBeLessThan(
      spawnSupervisor.mock.invocationCallOrder[0]
    );
  });

  it('unfolds the inspector and then the folder of a manager', async () => {
    withManagers();
    supervisorRunFiles.mockResolvedValue([
      { relativePath: 'INSTRUCTIONS.md', path: 'x', size: 1, modifiedAtMs: 1 },
    ]);
    render(<SupervisorRunsPanel onOpenFile={vi.fn()} onSelectAgent={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Release Desk/ }));
    expect(await screen.findByText('release-desk')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Folder ${desk.runDir}` }));
    expect(await screen.findByRole('button', { name: /^INSTRUCTIONS\.md/ })).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { SHOW_SUPERVISOR_RUNS_EVENT } from '@/lib/agents/showSupervisorRuns';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { QuickAccess } from './QuickAccess';

const { managerRegistry, managerArchive, openManager, revealInFileManager, supervisorRunsList } =
  vi.hoisted(() => ({
    managerRegistry: vi.fn(),
    managerArchive: vi.fn(async () => undefined),
    openManager: vi.fn(async () => undefined),
    revealInFileManager: vi.fn(async () => undefined),
    supervisorRunsList: vi.fn(async (): Promise<unknown[]> => []),
  }));

vi.mock('@/lib/tauri/supervisorManagers', () => ({
  supervisorManagersList: vi.fn(async () => []),
  managerRegistry,
  managerArchive,
  MANAGERS_CHANGED_EVENT: 'auric:managers-changed',
}));
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList }));
vi.mock('@/lib/tauri/opener', () => ({ revealInFileManager }));
vi.mock('@/lib/agents/openSupervisor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/openSupervisor')>()),
  openManager,
}));
vi.mock('@/lib/git/projectDirty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/git/projectDirty')>()),
  loadProjectsDirty: vi.fn(async () => ({})),
}));

const manager = (
  key: string,
  name: string,
  archivedAt: string | null = null
): SupervisorManager => ({
  key,
  name,
  runDir: `2026-10-21_${key}`,
  promotedAt: '2026-10-21T09:00:00Z',
  archivedAt,
  lastLaunch: null,
});

const supervisorOf = (key: string, patch: Partial<AgentInfo> = {}): AgentInfo => ({
  id: `sv-${key}`,
  name: key,
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: Date.now(),
  lastActivityAt: Date.now(),
  role: 'supervisor',
  supervisorKey: key,
  ...patch,
});

function registryWith(...managers: SupervisorManager[]) {
  managerRegistry.mockResolvedValue({ managers, error: null });
}

describe('Project Manager tiles', () => {
  beforeEach(() => {
    localStorage.clear();
    managerRegistry.mockReset();
    managerArchive.mockClear();
    openManager.mockClear();
    revealInFileManager.mockClear();
    supervisorRunsList.mockReset().mockResolvedValue([]);
    useStore.setState({ starredProjects: [], agents: [], toasts: [], rootPath: null });
  });

  afterEach(() => vi.restoreAllMocks());

  it('draws nothing, not even an invitation, while there are no managers', async () => {
    registryWith();
    render(<QuickAccess currentPath={null} />);
    await waitFor(() => expect(managerRegistry).toHaveBeenCalled());
    expect(screen.queryByTestId(/^quick-access-manager-item-/)).toBeNull();
  });

  it('shows a tile per non-archived manager set to show, by name, after the Supervisor tile', async () => {
    localStorage.setItem(
      APP_CONFIG_KEYS.supervisorManagers,
      JSON.stringify({ hidden: { quickAccess: false } })
    );
    registryWith(
      manager('release-desk', 'Release Desk'),
      manager('hidden', 'Hidden'),
      manager('old', 'Old', '2026-10-22T00:00:00Z'),
      manager('inbox-triage', 'Inbox Triage')
    );
    render(<QuickAccess currentPath={null} />);

    const tiles = await screen.findAllByTestId(/^quick-access-manager-item-/);
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual([
      'quick-access-manager-item-inbox-triage',
      'quick-access-manager-item-release-desk',
    ]);
    const dock = screen.getByTestId('quick-access-dock');
    expect(dock.firstElementChild).toBe(screen.getByTestId('quick-access-supervisor-item'));
    expect(screen.getByTestId('quick-access-manager-release-desk')).toHaveTextContent('RD');
  });

  it('opens the manager by its key on a click', async () => {
    registryWith(manager('release-desk', 'Release Desk'));
    render(<QuickAccess currentPath={null} />);

    fireEvent.click(await screen.findByTestId('quick-access-manager-release-desk'));

    await waitFor(() =>
      expect(openManager).toHaveBeenCalledWith(expect.anything(), 'release-desk', expect.anything())
    );
  });

  it('shows its state: idle, working, and waiting for the human', async () => {
    registryWith(
      manager('a-idle', 'A Idle'),
      manager('b-working', 'B Working'),
      manager('c-waiting', 'C Waiting')
    );
    useStore.setState({
      agents: [supervisorOf('b-working'), supervisorOf('c-waiting', { awaitingInput: true })],
    });
    render(<QuickAccess currentPath={null} />);

    const status = async (key: string) =>
      (await screen.findByTestId(`quick-access-manager-${key}`)).getAttribute('data-status');
    expect(await status('a-idle')).toBe('idle');
    expect(await status('b-working')).toBe('running');
    expect(await status('c-waiting')).toBe('attention');
    expect(screen.getByTestId('quick-access-manager-c-waiting')).toHaveAccessibleName(
      'C Waiting, needs you'
    );
    expect(screen.queryByTestId('quick-access-manager-dot-a-idle')).toBeNull();
  });

  describe('right-click', () => {
    async function openMenu() {
      registryWith(manager('release-desk', 'Release Desk'));
      render(<QuickAccess currentPath={null} />);
      fireEvent.contextMenu(await screen.findByTestId('quick-access-manager-release-desk'));
      return screen.getByRole('menu');
    }

    it('offers open, instructions, runs and archive', async () => {
      useStore.setState({ rootPath: '/Users/dev/project' });
      const menu = await openMenu();
      for (const name of ['Open', 'Show Instructions in Finder', 'Show in Runs', 'Archive…']) {
        expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
      }
    });

    it('leaves out "Show in Runs" where there is no rail to show', async () => {
      const menu = await openMenu();
      expect(within(menu).queryByRole('menuitem', { name: 'Show in Runs' })).toBeNull();
    });

    it('brings the runs rail forward', async () => {
      useStore.setState({ rootPath: '/Users/dev/project' });
      const heard = vi.fn();
      window.addEventListener(SHOW_SUPERVISOR_RUNS_EVENT, heard);
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Show in Runs' }));
      window.removeEventListener(SHOW_SUPERVISOR_RUNS_EVENT, heard);
      expect(heard).toHaveBeenCalledTimes(1);
    });

    it('reveals the instructions file of the manager folder in Finder', async () => {
      supervisorRunsList.mockResolvedValue([
        {
          name: '2026-10-21_release-desk',
          path: '/Users/dev/.auric/supervisors/2026-10-21_release-desk',
        },
      ]);
      fireEvent.click(
        within(await openMenu()).getByRole('menuitem', { name: 'Show Instructions in Finder' })
      );
      await waitFor(() =>
        expect(revealInFileManager).toHaveBeenCalledWith(
          '/Users/dev/.auric/supervisors/2026-10-21_release-desk/INSTRUCTIONS.md'
        )
      );
    });

    it('says so when the folder is gone', async () => {
      fireEvent.click(
        within(await openMenu()).getByRole('menuitem', { name: 'Show Instructions in Finder' })
      );
      await waitFor(() =>
        expect(useStore.getState().toasts.at(-1)?.message).toBe(
          'Could not show the instructions: its folder is gone'
        )
      );
      expect(revealInFileManager).not.toHaveBeenCalled();
    });

    it('archives only after the human confirms', async () => {
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Archive…' }));
      expect(managerArchive).not.toHaveBeenCalled();

      fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
      await waitFor(() => expect(managerArchive).toHaveBeenCalledWith('release-desk'));
    });

    it('keeps the manager when the human cancels', async () => {
      fireEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Archive…' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(managerArchive).not.toHaveBeenCalled();
    });
  });
});

describe('the Supervisor tile menu lists Project Managers', () => {
  beforeEach(() => {
    localStorage.clear();
    managerRegistry.mockReset();
    openManager.mockClear();
    supervisorRunsList.mockReset().mockResolvedValue([]);
    useStore.setState({ starredProjects: [], agents: [], toasts: [], rootPath: null });
  });

  it('has no submenu without managers', async () => {
    registryWith();
    render(<QuickAccess currentPath={null} />);
    await waitFor(() => expect(managerRegistry).toHaveBeenCalled());
    fireEvent.contextMenu(screen.getByTestId('quick-access-supervisor'));
    expect(screen.queryByRole('menuitem', { name: 'Project Managers' })).toBeNull();
  });

  it('opens a submenu with every non-archived manager, even one hidden from Quick Access', async () => {
    localStorage.setItem(
      APP_CONFIG_KEYS.supervisorManagers,
      JSON.stringify({ hidden: { quickAccess: false } })
    );
    registryWith(
      manager('release-desk', 'Release Desk'),
      manager('hidden', 'Hidden'),
      manager('old', 'Old', '2026-10-22T00:00:00Z')
    );
    render(<QuickAccess currentPath={null} />);
    await screen.findByTestId('quick-access-manager-release-desk');

    fireEvent.contextMenu(screen.getByTestId('quick-access-supervisor'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project Managers' }));

    const menu = screen.getByRole('menu');
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(['Hidden', 'Release Desk', 'Back']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hidden' }));
    await waitFor(() =>
      expect(openManager).toHaveBeenCalledWith(expect.anything(), 'hidden', expect.anything())
    );
  });

  it('goes back to the supervisor entries', async () => {
    registryWith(manager('release-desk', 'Release Desk'));
    render(<QuickAccess currentPath={null} />);
    await screen.findByTestId('quick-access-manager-release-desk');

    fireEvent.contextMenu(screen.getByTestId('quick-access-supervisor'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project Managers' }));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: 'Back' })));

    expect(screen.getByRole('menuitem', { name: 'Start Supervisor' })).toBeInTheDocument();
  });
});

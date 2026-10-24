import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { readManagerPresentations } from '@/lib/quickAccess/managerPresentation';
import { saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { SupervisorManagersSettings } from './SupervisorManagersSettings';

const mocks = vi.hoisted(() => ({
  managerRegistry: vi.fn(),
  managerCreate: vi.fn(async () => undefined),
  managerArchive: vi.fn(async () => undefined),
  managerRename: vi.fn(async () => undefined),
  listProviders: vi.fn(async (): Promise<unknown[]> => []),
  supervisorPolicyGet: vi.fn(async () => ({ policy: { supervisor: { provider: 'claude' } } })),
  managerRestore: vi.fn(async () => undefined),
  managerRemove: vi.fn(async () => undefined),
  managerInstructions: vi.fn(async () => '# Instructions\n\nWrite every release note.'),
  managerMemory: vi.fn(async () => ({
    concepts: {},
    deprecated: 0,
    newestChangeMs: null,
    findings: [],
    okf: 'ok',
    checkedAt: null,
    lastSession: null,
  })),
  managerValidate: vi.fn(),
  supervisorRunsList: vi.fn(),
  revealInFileManager: vi.fn(async () => undefined),
  openPathInDefaultApp: vi.fn(async () => undefined),
  openManager: vi.fn(async () => undefined),
  machineDependencies: vi.fn(async () => []),
  copyToClipboard: vi.fn(async () => true),
}));

vi.mock('@/lib/tauri/supervisorManagers', () => ({
  managerRegistry: mocks.managerRegistry,
  managerCreate: mocks.managerCreate,
  managerArchive: mocks.managerArchive,
  managerRename: mocks.managerRename,
  managerRestore: mocks.managerRestore,
  managerRemove: mocks.managerRemove,
  managerInstructions: mocks.managerInstructions,
  managerMemory: mocks.managerMemory,
  managerValidate: mocks.managerValidate,
  supervisorManagersList: vi.fn(async () => []),
  MANAGERS_CHANGED_EVENT: 'auric:managers-changed',
}));
vi.mock('@/lib/tauri/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/providers')>()),
  listProviders: mocks.listProviders,
}));
vi.mock('@/lib/tauri/supervisorPolicy', () => ({ supervisorPolicyGet: mocks.supervisorPolicyGet }));
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList: mocks.supervisorRunsList }));
vi.mock('@/lib/tauri/opener', () => ({
  revealInFileManager: mocks.revealInFileManager,
  openPathInDefaultApp: mocks.openPathInDefaultApp,
}));
vi.mock('@/lib/tauri/machine', () => ({ machineDependencies: mocks.machineDependencies }));
vi.mock('@/lib/tauri/clipboard', () => ({ copyToClipboard: mocks.copyToClipboard }));
vi.mock('@/lib/agents/openSupervisor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agents/openSupervisor')>()),
  openManager: mocks.openManager,
}));

const FOLDER = '2026-10-21_090000';
const manager = (
  key: string,
  name: string,
  archivedAt: string | null = null
): SupervisorManager => ({
  key,
  name,
  runDir: key === 'release-desk' ? FOLDER : `2026-10-21_${key}`,
  promotedAt: '2026-10-21T09:00:00Z',
  archivedAt,
  lastLaunch: null,
});

const run = (name: string) => ({
  name,
  path: `/Users/dev/.auric/supervisors/${name}`,
  modifiedAtMs: 1,
  fileCount: 3,
  truncated: false,
});

const liveRelease: AgentInfo = {
  id: 'sv-1',
  name: 'sv-1',
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 1,
  role: 'supervisor',
  supervisorKey: 'release-desk',
};

function registryWith(error: string | null, ...managers: SupervisorManager[]) {
  mocks.managerRegistry.mockResolvedValue({ managers, error });
}

describe('Settings → Supervisor → Project Managers', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.listProviders.mockResolvedValue([]);
    mocks.supervisorRunsList.mockResolvedValue([run(FOLDER)]);
    useStore.setState({ agents: [], toasts: [] });
  });

  it('offers New Project Manager and says runs can also be promoted from the rail', async () => {
    registryWith(null);
    render(<SupervisorManagersSettings />);

    expect(await screen.findByTestId('manager-settings-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/Runs can also be promoted from the Supervisor Runs rail/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Project Manager…' })).toBeEnabled();
  });

  it('lists each manager with its address and whether it runs', async () => {
    registryWith(
      null,
      manager('release-desk', 'Release Desk'),
      manager('inbox-triage', 'Inbox Triage')
    );
    useStore.setState({ agents: [liveRelease] });
    render(<SupervisorManagersSettings />);

    const release = await screen.findByTestId('manager-settings-release-desk');
    expect(release).toHaveTextContent('release-desk');
    expect(release).toHaveTextContent('Running');
    expect(screen.getByTestId('manager-settings-inbox-triage')).toHaveTextContent('Not running');
  });

  it('says once, not per manager, that the menu bar is off', async () => {
    registryWith(
      null,
      manager('release-desk', 'Release Desk'),
      manager('inbox-triage', 'Inbox Triage')
    );
    render(<SupervisorManagersSettings />);

    expect(await screen.findByTestId('manager-settings-menu-bar-note')).toHaveTextContent(
      'The menu bar icon is off'
    );
    expect(screen.getAllByText(/menu bar icon is off/)).toHaveLength(1);
  });

  it('only mentions shortcuts once the icon is on and the shortcuts are not', async () => {
    localStorage.setItem(APP_CONFIG_KEYS.supervisorMenuBar, 'true');
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    expect(await screen.findByTestId('manager-settings-menu-bar-note')).toHaveTextContent(
      'Shortcuts only work from other apps'
    );
  });

  it('stays quiet when both are on', async () => {
    localStorage.setItem(APP_CONFIG_KEYS.supervisorMenuBar, 'true');
    localStorage.setItem(APP_CONFIG_KEYS.supervisorGlobalShortcuts, 'true');
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    await screen.findByTestId('manager-settings-release-desk');
    expect(screen.queryByTestId('manager-settings-menu-bar-note')).toBeNull();
  });

  it('writes the presentation as the switches are flipped', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    const quickAccess = await screen.findByTestId('manager-quick-access-release-desk');
    expect(quickAccess).toBeChecked();
    fireEvent.click(quickAccess);
    fireEvent.click(screen.getByTestId('manager-menu-bar-release-desk'));

    expect(readManagerPresentations()).toEqual({
      'release-desk': { quickAccess: false, menuBar: false },
    });
  });

  it('records a shortcut by its keys and clears it again', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    const field = await screen.findByRole('textbox', { name: 'Release Desk shortcut' });
    fireEvent.keyDown(field, { code: 'KeyR', ctrlKey: true, altKey: true });
    expect(readManagerPresentations()['release-desk']?.shortcut).toBe('Control+Alt+KeyR');

    fireEvent.keyDown(field, { key: 'Backspace', code: 'Backspace' });
    expect(readManagerPresentations()['release-desk']?.shortcut).toBeUndefined();
  });

  it('warns when a skill already claims the same keys', async () => {
    saveSupervisorPresets({
      skills: [{ id: 'p1', label: 'Ping', prompt: 'x', shortcut: 'Control+Alt+KeyR' }],
      wheelSlots: [],
    });
    localStorage.setItem(
      APP_CONFIG_KEYS.supervisorManagers,
      JSON.stringify({ 'release-desk': { shortcut: 'Control+Alt+KeyR' } })
    );
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    expect(await screen.findByText(/Another shortcut uses these keys too/)).toBeInTheDocument();
  });

  it('shows the same inspector as the rail under Details', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));

    expect(await screen.findByText('Write every release note.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Folder ' + FOLDER }));
    await waitFor(() =>
      expect(mocks.revealInFileManager).toHaveBeenCalledWith(
        `/Users/dev/.auric/supervisors/${FOLDER}`
      )
    );
  });

  it('opens the instructions file in the default app, not in Finder', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit instructions' }));
    await waitFor(() =>
      expect(mocks.openPathInDefaultApp).toHaveBeenCalledWith(
        `/Users/dev/.auric/supervisors/${FOLDER}/INSTRUCTIONS.md`
      )
    );
    expect(mocks.revealInFileManager).not.toHaveBeenCalled();
  });

  it('opens a manager by its key', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    const row = await screen.findByTestId('manager-settings-release-desk');
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(mocks.openManager).toHaveBeenCalledWith(
        expect.anything(),
        'release-desk',
        expect.anything(),
        undefined
      )
    );
  });

  it('renames a manager by its key through the name sheet', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'), manager('inbox', 'Inbox'));
    render(<SupervisorManagersSettings />);

    const row = await screen.findByTestId('manager-settings-release-desk');
    fireEvent.click(within(row).getByRole('button', { name: 'Rename Release Desk…' }));
    const field = await screen.findByLabelText('Name');
    expect(field).toHaveValue('Release Desk');
    expect(screen.getByText('Address: release-desk')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: 'Ship Room' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(mocks.managerRename).toHaveBeenCalledWith('release-desk', 'Ship Room')
    );
  });

  it("refuses an empty name and a neighbour's name before asking Rust", async () => {
    registryWith(null, manager('release-desk', 'Release Desk'), manager('inbox', 'Inbox'));
    render(<SupervisorManagersSettings />);

    const row = await screen.findByTestId('manager-settings-release-desk');
    fireEvent.click(within(row).getByRole('button', { name: 'Rename Release Desk…' }));
    const field = await screen.findByLabelText('Name');

    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'INBOX' } });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    expect(screen.getByText('A Project Manager with this name exists.')).toBeInTheDocument();
    expect(mocks.managerRename).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'release DESK' } });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
  });

  it('keeps archived managers behind a fold, with restore and a confirmed remove', async () => {
    registryWith(null, manager('old', 'Old Desk', '2026-10-22T00:00:00Z'));
    render(<SupervisorManagersSettings />);

    expect(screen.queryByText('Old Desk')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Archived \(1\)/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(mocks.managerRestore).toHaveBeenCalledWith('old'));

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    expect(mocks.managerRemove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.managerRemove).toHaveBeenCalledWith('old'));
  });

  it('turns writes off with the reason in view when the registry cannot be read', async () => {
    registryWith(
      'The registry could not be read.',
      manager('old', 'Old Desk', '2026-10-22T00:00:00Z')
    );
    render(<SupervisorManagersSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The registry could not be read.');
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveAttribute(
      'title',
      'The registry could not be read.'
    );
  });

  describe('the working loop', () => {
    const MODELS = [
      { value: 'big', label: 'Big', rank: 3 },
      { value: 'small', label: 'Small', rank: 1 },
      { value: 'retired', label: 'Retired', rank: 2, available: false },
    ];

    it('creates a manager through the name sheet', async () => {
      registryWith(null);
      render(<SupervisorManagersSettings />);
      fireEvent.click(await screen.findByRole('button', { name: 'New Project Manager…' }));
      expect(screen.getByRole('dialog', { name: 'New Project Manager' })).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Inbox Triage' },
      });
      expect(screen.getByText('Address: inbox-triage')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(mocks.managerCreate).toHaveBeenCalledWith('Inbox Triage'));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it("keeps the sheet open with Rust's sentence when the name is refused", async () => {
      registryWith(null);
      mocks.managerCreate.mockRejectedValueOnce(
        new Error("A Project Manager named 'Inbox Triage' already exists.")
      );
      render(<SupervisorManagersSettings />);
      fireEvent.click(await screen.findByRole('button', { name: 'New Project Manager…' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Inbox Triage' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
      expect(screen.getByRole('dialog', { name: 'New Project Manager' })).toBeInTheDocument();
    });

    it('turns New off with the reason when the registry cannot be read', async () => {
      registryWith('The registry could not be read.');
      render(<SupervisorManagersSettings />);
      const button = await screen.findByRole('button', { name: 'New Project Manager…' });
      await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
      expect(button.getAttribute('aria-describedby')).toBe(
        screen.getByText('The registry could not be read.').id
      );
      fireEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('asks a stopped manager from its row', async () => {
      registryWith(null, manager('release-desk', 'Release Desk'));
      render(<SupervisorManagersSettings />);
      const row = await screen.findByTestId('manager-settings-release-desk');
      fireEvent.click(within(row).getByRole('button', { name: 'Ask Release Desk…' }));
      expect(screen.getByText('Release Desk starts and works on this first.')).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: 'Task' }), {
        target: { value: 'Plan the release.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
      await waitFor(() =>
        expect(mocks.openManager).toHaveBeenCalledWith(
          expect.anything(),
          'release-desk',
          expect.anything(),
          { task: 'Plan the release.' }
        )
      );
    });

    it('tells the sheet a running manager gets a message', async () => {
      registryWith(null, manager('release-desk', 'Release Desk'));
      useStore.setState({ agents: [liveRelease] });
      render(<SupervisorManagersSettings />);
      const row = await screen.findByTestId('manager-settings-release-desk');
      fireEvent.click(within(row).getByRole('button', { name: 'Ask Release Desk…' }));
      expect(
        screen.getByText('Release Desk is running; this goes in as a message.')
      ).toBeInTheDocument();
    });

    it("offers Default and the supervisor provider's available models, smallest first", async () => {
      mocks.listProviders.mockResolvedValue([{ id: 'claude', name: 'Claude', models: MODELS }]);
      registryWith(null, manager('release-desk', 'Release Desk'));
      render(<SupervisorManagersSettings />);
      const picker = await screen.findByRole('combobox', { name: 'Release Desk model' });
      await waitFor(() =>
        expect(
          within(picker)
            .getAllByRole('option')
            .map((o) => o.textContent)
        ).toEqual(['Default', 'Small', 'Big'])
      );
    });

    it('stores the chosen model and clears it again with Default', async () => {
      mocks.listProviders.mockResolvedValue([{ id: 'claude', name: 'Claude', models: MODELS }]);
      registryWith(null, manager('release-desk', 'Release Desk'));
      render(<SupervisorManagersSettings />);
      const picker = await screen.findByRole('combobox', { name: 'Release Desk model' });
      await screen.findByRole('option', { name: 'Small' });
      fireEvent.change(picker, { target: { value: 'small' } });
      expect(readManagerPresentations()['release-desk']?.model).toBe('small');
      fireEvent.change(picker, { target: { value: '' } });
      expect(readManagerPresentations()['release-desk']?.model).toBeUndefined();
    });

    it('keeps a stored model the provider stopped offering visible, marked as such', async () => {
      localStorage.setItem(
        APP_CONFIG_KEYS.supervisorManagers,
        JSON.stringify({ 'release-desk': { model: 'gone-model' } })
      );
      registryWith(null, manager('release-desk', 'Release Desk'));
      render(<SupervisorManagersSettings />);
      expect(
        await screen.findByRole('option', { name: 'gone-model (no longer offered)' })
      ).toBeInTheDocument();
    });

    describe('a manager whose folder is gone', () => {
      const gone = { ...manager('gone', 'Gone Desk'), runMissing: true };

      it('reads "Folder missing" and offers neither Open nor Ask', async () => {
        registryWith(null, gone);
        render(<SupervisorManagersSettings />);
        const row = await screen.findByTestId('manager-settings-gone');
        expect(row).toHaveTextContent('Folder missing');
        expect(within(row).queryByRole('button', { name: 'Open' })).toBeNull();
        expect(within(row).queryByRole('button', { name: /^Ask / })).toBeNull();
      });

      it('archives after a confirmation', async () => {
        registryWith(null, gone);
        render(<SupervisorManagersSettings />);
        const row = await screen.findByTestId('manager-settings-gone');
        fireEvent.click(within(row).getByRole('button', { name: 'Archive…' }));
        expect(mocks.managerArchive).not.toHaveBeenCalled();
        fireEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' })
        );
        await waitFor(() => expect(mocks.managerArchive).toHaveBeenCalledWith('gone'));
      });

      it('says so in Details instead of throwing when there is no run to inspect', async () => {
        registryWith(null, gone);
        mocks.supervisorRunsList.mockResolvedValue([]);
        render(<SupervisorManagersSettings />);
        fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
        expect(screen.getByText(/Its folder is gone/)).toBeInTheDocument();
      });

      it('is marked in the archived list too', async () => {
        registryWith(null, { ...gone, archivedAt: '2026-10-22T00:00:00Z' });
        render(<SupervisorManagersSettings />);
        fireEvent.click(await screen.findByRole('button', { name: /Archived \(1\)/ }));
        expect(screen.getByText(/Folder missing/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
      });
    });
  });
});

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
  })),
  managerValidate: vi.fn(),
  supervisorRunsList: vi.fn(),
  revealInFileManager: vi.fn(async () => undefined),
  openManager: vi.fn(async () => undefined),
  machineDependencies: vi.fn(async () => []),
  copyToClipboard: vi.fn(async () => true),
}));

vi.mock('@/lib/tauri/supervisorManagers', () => ({
  managerRegistry: mocks.managerRegistry,
  managerRestore: mocks.managerRestore,
  managerRemove: mocks.managerRemove,
  managerInstructions: mocks.managerInstructions,
  managerMemory: mocks.managerMemory,
  managerValidate: mocks.managerValidate,
  supervisorManagersList: vi.fn(async () => []),
  MANAGERS_CHANGED_EVENT: 'auric:managers-changed',
}));
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList: mocks.supervisorRunsList }));
vi.mock('@/lib/tauri/opener', () => ({ revealInFileManager: mocks.revealInFileManager }));
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
    mocks.supervisorRunsList.mockResolvedValue([run(FOLDER)]);
    useStore.setState({ agents: [], toasts: [] });
  });

  it('says how a manager is made instead of offering a New button', async () => {
    registryWith(null);
    render(<SupervisorManagersSettings />);

    expect(await screen.findByTestId('manager-settings-empty')).toBeInTheDocument();
    expect(screen.getByText(/Promote a run from the Supervisor Runs rail/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new/i })).toBeNull();
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

  it('opens a manager by its key', async () => {
    registryWith(null, manager('release-desk', 'Release Desk'));
    render(<SupervisorManagersSettings />);

    const row = await screen.findByTestId('manager-settings-release-desk');
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(mocks.openManager).toHaveBeenCalledWith(
        expect.anything(),
        'release-desk',
        expect.anything()
      )
    );
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
});

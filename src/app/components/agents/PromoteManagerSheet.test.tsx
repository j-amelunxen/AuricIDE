import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { PromoteManagerSheet } from './PromoteManagerSheet';

const { managerPromote, machineDependencies } = vi.hoisted(() => ({
  managerPromote: vi.fn(),
  machineDependencies: vi.fn(),
}));
vi.mock('@/lib/tauri/supervisorManagers', () => ({ managerPromote }));
vi.mock('@/lib/tauri/machine', () => ({ machineDependencies }));

const RUN: SupervisorRun = {
  name: '2026-10-21_090000',
  path: '/home/me/.auric/supervisors/2026-10-21_090000',
  modifiedAtMs: 1,
  fileCount: 3,
  truncated: false,
};

const manager = (over: Partial<SupervisorManager> = {}): SupervisorManager => ({
  key: 'release-desk',
  name: 'Release Desk',
  runDir: '2026-10-01_090000',
  promotedAt: '2026-10-22T10:15:00Z',
  archivedAt: null,
  lastLaunch: null,
  ...over,
});

const liveAgent: AgentInfo = {
  id: 'sup-1',
  name: 'Supervisor',
  model: 'sonnet',
  provider: 'claude',
  status: 'running',
  startedAt: 1,
  role: 'supervisor',
  supervisorKey: 'mail-triage',
  repoPath: RUN.path,
};

function open(props: Partial<React.ComponentProps<typeof PromoteManagerSheet>> = {}) {
  const onClose = vi.fn();
  const onPromoted = vi.fn();
  render(
    <PromoteManagerSheet
      run={RUN}
      liveSupervisor={undefined}
      takenKeys={[]}
      managers={[]}
      onPromoted={onPromoted}
      onClose={onClose}
      {...props}
    />
  );
  return { onClose, onPromoted };
}

describe('PromoteManagerSheet', () => {
  beforeEach(() => {
    managerPromote.mockReset().mockResolvedValue(manager({ key: 'inbox-triage' }));
    machineDependencies.mockReset().mockResolvedValue([{ id: 'okf', ok: true }]);
    useStore.setState({ toasts: [] });
  });

  it('starts empty for a run without an address', () => {
    open();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  });

  it('prefills the name from the key of the supervisor working in the run, and shows that key', () => {
    open({ liveSupervisor: liveAgent });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mail Triage');
    expect(screen.getByText('Address: mail-triage')).toBeInTheDocument();
  });

  it('keeps a run’s own address even when the name is edited', () => {
    open({ liveSupervisor: liveAgent });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Something Else' },
    });
    expect(screen.getByText('Address: mail-triage')).toBeInTheDocument();
  });

  it('does not claim a run’s key that another manager already holds, as Rust does not', () => {
    open({
      liveSupervisor: liveAgent,
      managers: [manager({ key: 'mail-triage', name: 'Mail Triage' })],
      takenKeys: ['mail-triage'],
    });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Inbox' },
    });
    expect(screen.getByText('Address: inbox')).toBeInTheDocument();
  });

  it('keeps the key a stopped run recorded in its supervisor file, as Rust does', () => {
    open({ run: { ...RUN, storedKey: 'release-desk' } });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Release Desk');
    expect(screen.getByText('Address: release-desk')).toBeInTheDocument();
  });

  it('drops a recorded key that a live supervisor elsewhere holds, as Rust does', () => {
    open({ run: { ...RUN, storedKey: 'release-desk' }, takenKeys: ['release-desk'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Inbox' },
    });
    expect(screen.getByText('Address: inbox')).toBeInTheDocument();
  });

  it('shows the address Rust folds for letters Unicode normalisation would drop', () => {
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Straße Łódź' },
    });
    expect(screen.getByText('Address: strasse-lodz')).toBeInTheDocument();
  });

  it('derives the address from the name and steps past keys already taken', () => {
    open({ takenKeys: ['inbox-triage'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Inbox Triage' },
    });
    expect(screen.getByText('Address: inbox-triage-2')).toBeInTheDocument();
  });

  it('says what the promotion keeps, and that a running supervisor keeps running', () => {
    open({ liveSupervisor: liveAgent });
    expect(screen.getByText(/keeps its folder and everything in it/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'It keeps running as it is and works as a Project Manager from its next start.'
      )
    ).toBeInTheDocument();
  });

  it('does not mention running for a stopped run', () => {
    open();
    expect(screen.queryByText(/keeps running as it is/)).not.toBeInTheDocument();
  });

  it('promotes the run folder under the typed name and reports the new manager', async () => {
    const { onPromoted, onClose } = open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Inbox Triage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(managerPromote).toHaveBeenCalledWith(RUN.name, 'Inbox Triage');
    expect(onPromoted).toHaveBeenCalledWith(expect.objectContaining({ key: 'inbox-triage' }));
  });

  it('blocks promotion with the reason while the registry cannot be read', () => {
    open({ registryError: 'supervisor-managers.json could not be read: x. It was left as it is.' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Fresh' } });
    expect(screen.getByRole('button', { name: 'Promote' })).toBeDisabled();
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });

  it('adds one quiet line when okf is missing, and no button for it', async () => {
    machineDependencies.mockResolvedValue([{ id: 'okf', ok: false }]);
    open();
    expect(
      await screen.findByText(
        'Memory checks need okf, which is not installed. The Project Manager works without it.'
      )
    ).toBeInTheDocument();
  });

  it('stays quiet about okf when it is there, or when the machine cannot be asked', async () => {
    open();
    await waitFor(() => expect(machineDependencies).toHaveBeenCalled());
    expect(screen.queryByText(/Memory checks need okf/)).not.toBeInTheDocument();
  });
});

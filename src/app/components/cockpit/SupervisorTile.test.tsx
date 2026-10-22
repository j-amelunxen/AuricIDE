import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { loadSupervisorPresets, saveSupervisorPresets } from '@/lib/quickAccess/supervisorPresets';
import {
  defaultSupervisorProjectPolicy,
  emptySupervisorPolicy,
  type SupervisorPolicy,
} from '@/lib/config/supervisorPolicy';
import { useStore } from '@/lib/store';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import { QuickAccess } from './QuickAccess';

const { spawnAgent, supervisorPolicyGet, supervisorRunsList } = vi.hoisted(() => ({
  supervisorRunsList: vi.fn(async (): Promise<unknown[]> => []),
  spawnAgent: vi.fn(async (config: AgentConfig) => ({
    id: 'sup-new',
    name: config.name,
    model: config.model,
    provider: config.provider ?? 'claude',
    status: 'running' as const,
    startedAt: 1,
    role: config.role,
  })),
  supervisorPolicyGet: vi.fn(),
}));

vi.mock('@/lib/tauri/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/agents')>()),
  spawnAgent,
  recordAgentPromptHistory: vi.fn(async () => undefined),
}));
vi.mock('@/lib/tauri/supervisorPolicy', () => ({ supervisorPolicyGet }));
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList }));
const { managerRegistry } = vi.hoisted(() => ({
  managerRegistry: vi.fn(async (): Promise<{ managers: unknown[]; error: string | null }> => ({
    managers: [],
    error: null,
  })),
}));
vi.mock('@/lib/tauri/supervisorManagers', () => ({
  supervisorManagersList: vi.fn(async () => []),
  managerRegistry,
  MANAGERS_CHANGED_EVENT: 'auric:managers-changed',
}));
vi.mock('@/lib/tauri/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/providers')>()),
  listProviders: vi.fn(async () => [
    {
      id: 'claude',
      name: 'Claude Code',
      models: [{ value: 'sonnet', label: 'Sonnet', rank: 2 }],
      permissionModes: [],
      defaultModel: 'sonnet',
      defaultPermissionMode: 'default',
    },
  ]),
}));
vi.mock('@/lib/tauri/providerPolicy', () => ({
  projectProviderPolicyGet: vi.fn(async () => ({ allow: null, deny: [] })),
}));
vi.mock('@/lib/git/projectDirty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/git/projectDirty')>()),
  loadProjectsDirty: vi.fn(async () => ({})),
}));

function allowing(path: string): SupervisorPolicy {
  const policy = emptySupervisorPolicy();
  policy.projects[path] = { ...defaultSupervisorProjectPolicy(), allowed: true };
  return policy;
}

describe('Supervisor tile', () => {
  beforeEach(() => {
    spawnAgent.mockClear();
    supervisorPolicyGet.mockReset();
    useStore.setState({ starredProjects: [], agents: [], toasts: [], selectedAgentId: null });
  });

  it('is in the dock even with no project starred', () => {
    render(<QuickAccess currentPath={null} />);
    expect(screen.getByTestId('quick-access-supervisor')).toHaveAccessibleName(
      'Start a supervisor agent'
    );
  });

  it('starts a supervisor and shows its terminal', async () => {
    supervisorPolicyGet.mockResolvedValue({ policy: allowing('/work/project-a'), rejected: [] });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    fireEvent.click(screen.getByTestId('quick-access-supervisor'));

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-new'));
    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(spawnAgent.mock.calls[0][0]).toMatchObject({
      role: 'supervisor',
      provider: 'claude',
      headless: false,
    });
  });

  it('goes to Settings → Supervisor when no project is allowed', async () => {
    supervisorPolicyGet.mockResolvedValue({ policy: emptySupervisorPolicy(), rejected: [] });
    const onOpenSettings = vi.fn();
    const onSelectAgent = vi.fn();
    render(
      <QuickAccess
        currentPath={null}
        onOpenSettings={onOpenSettings}
        onSelectAgent={onSelectAgent}
      />
    );

    fireEvent.click(screen.getByTestId('quick-access-supervisor'));

    await waitFor(() => expect(onOpenSettings).toHaveBeenCalledWith('supervisor'));
    expect(spawnAgent).not.toHaveBeenCalled();
    expect(onSelectAgent).not.toHaveBeenCalled();
    expect(useStore.getState().toasts.at(-1)?.message).toMatch(/allow at least one project/i);
  });

  it('brings the running supervisor forward instead of starting another', async () => {
    const running: AgentInfo = {
      id: 'sup-running',
      name: 'Supervisor',
      model: 'sonnet',
      provider: 'claude',
      status: 'running',
      startedAt: 1,
      role: 'supervisor',
    };
    useStore.setState({ agents: [running] });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);
    const tile = screen.getByTestId('quick-access-supervisor');
    expect(tile).toHaveAccessibleName('Open the running supervisor');

    fireEvent.click(tile);

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-running'));
    expect(supervisorPolicyGet).not.toHaveBeenCalled();
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('says why when the start fails', async () => {
    supervisorPolicyGet.mockRejectedValue(new Error('policy unreadable'));
    render(<QuickAccess currentPath={null} />);
    fireEvent.click(screen.getByTestId('quick-access-supervisor'));
    await waitFor(() =>
      expect(useStore.getState().toasts.at(-1)?.message).toBe(
        'Could not start the supervisor: policy unreadable'
      )
    );
  });
});

describe('Supervisor tile as a Quick Access tile', () => {
  const status = {
    id: 'sk-status',
    label: 'Status round',
    prompt: 'Ask every project for its build status',
    model: 'haiku',
  };
  const running: AgentInfo = {
    id: 'sup-running',
    name: 'Supervisor',
    model: 'sonnet',
    provider: 'claude',
    status: 'running',
    startedAt: 1,
    role: 'supervisor',
  };

  beforeEach(() => {
    localStorage.clear();
    spawnAgent.mockClear();
    supervisorRunsList.mockReset().mockResolvedValue([]);
    supervisorPolicyGet.mockReset();
    supervisorPolicyGet.mockResolvedValue({ policy: allowing('/work/project-a'), rejected: [] });
    useStore.setState({ starredProjects: [], agents: [], toasts: [], selectedAgentId: null });
  });

  function openMenu() {
    fireEvent.contextMenu(screen.getByTestId('quick-access-supervisor'));
    return screen.getByRole('menu');
  }

  it('lists its skills and its own actions on right-click', () => {
    saveSupervisorPresets({ skills: [status], wheelSlots: [] });
    render(<QuickAccess currentPath={null} />);
    const menu = openMenu();
    for (const name of [
      'Status round',
      'Start Supervisor',
      'Supervisor Permissions…',
      'Quick Access Settings',
    ]) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    // Project actions make no sense on a tile that is no folder.
    expect(within(menu).queryByRole('menuitem', { name: /working directory/i })).toBeNull();
  });

  it("starts a supervisor on a skill: the prompt is its first task, the model the skill's", async () => {
    saveSupervisorPresets({ skills: [status], wheelSlots: [] });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Status round' }));

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-new'));
    const config = spawnAgent.mock.calls[0][0];
    expect(config.task).toMatch(/## Your first task\n\nAsk every project for its build status$/);
    expect(config.model).toBe('haiku');
  });

  it('starts a new supervisor on a skill even while one runs', async () => {
    saveSupervisorPresets({ skills: [status], wheelSlots: [] });
    const sendAgentInput = vi.fn(async () => undefined);
    useStore.setState({ agents: [running], sendAgentInput });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Status round' }));

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-new'));
    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(spawnAgent.mock.calls[0][0].task).toMatch(/Ask every project for its build status$/);
    expect(sendAgentInput).not.toHaveBeenCalled();
  });

  it('starts another supervisor from the menu and lists each running one to open', async () => {
    const research: AgentInfo = {
      ...running,
      id: 'sup-research',
      name: 'Supervisor 2',
      supervisorKey: 'research',
      startedAt: 2,
    };
    useStore.setState({ agents: [running, research] });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    let menu = openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Start Supervisor' })).toBeNull();
    // Newest first, by its key where it has one.
    const opens = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
      .filter((text) => text?.startsWith('Open '));
    expect(opens).toEqual(['Open research', 'Open Supervisor']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open Supervisor' }));
    expect(onSelectAgent).toHaveBeenCalledWith('sup-running');
    expect(spawnAgent).not.toHaveBeenCalled();

    menu = openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Start new Supervisor' }));
    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-new'));
    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(spawnAgent.mock.calls[0][0].role).toBe('supervisor');
  });

  it('opens the newest running supervisor on a plain click', async () => {
    const research: AgentInfo = { ...running, id: 'sup-research', startedAt: 2 };
    useStore.setState({ agents: [research, running] });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    fireEvent.click(screen.getByTestId('quick-access-supervisor'));

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-research'));
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('offers the most recent runs to resume, in the folder Rust is asked for', async () => {
    supervisorPolicyGet.mockResolvedValue({ policy: allowing('/work/project-a'), rejected: [] });
    const run = (name: string) => ({
      name,
      path: `/home/me/.auric/supervisors/${name}`,
      modifiedAtMs: 1,
      fileCount: 2,
      truncated: false,
    });
    supervisorRunsList.mockResolvedValue(
      [
        '2026-10-19_090000',
        '2026-10-18_090000',
        '2026-10-17_090000',
        '2026-10-16_090000',
        '2026-10-15_090000',
        '2026-10-14_090000',
      ].map(run)
    );
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    const menu = openMenu();
    const latest = await within(menu).findByRole('menuitem', { name: 'Oct 19, 09:00' });
    expect(within(menu).queryByRole('menuitem', { name: 'Oct 14, 09:00' })).toBeNull();
    fireEvent.click(latest);

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-new'));
    const config = spawnAgent.mock.calls[0][0];
    expect(config.resumeRunDir).toBe('/home/me/.auric/supervisors/2026-10-19_090000');
    expect(config.task).toContain('## Picking up an earlier run');
  });

  it('offers resume while a supervisor runs, and opens the run that is already live', async () => {
    supervisorRunsList.mockResolvedValue([
      {
        name: '2026-10-19_090000',
        path: '/r/live',
        modifiedAtMs: 1,
        fileCount: 1,
        truncated: false,
      },
      {
        name: '2026-10-18_090000',
        path: '/r/old',
        modifiedAtMs: 1,
        fileCount: 1,
        truncated: false,
      },
    ]);
    useStore.setState({
      agents: [{ ...running, supervisorKey: 'mail-triage', repoPath: '/r/live' }],
    });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);
    const menu = openMenu();

    expect(await within(menu).findByText('Resume Supervisor')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Oct 18, 09:00' })).toBeInTheDocument();
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Oct 19, 09:00 · open in mail-triage' })
    );

    expect(onSelectAgent).toHaveBeenCalledWith('sup-running');
    expect(spawnAgent).not.toHaveBeenCalled();
  });

  it('has the runs ready before the menu opens, so nothing appears under the pointer', async () => {
    supervisorRunsList.mockResolvedValue([
      { name: '2026-10-19_090000', path: '/r/x', modifiedAtMs: 1, fileCount: 1, truncated: false },
    ]);
    render(<QuickAccess currentPath={null} />);
    await waitFor(() => expect(supervisorRunsList).toHaveBeenCalled());
    await act(async () => undefined);

    const menu = openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Oct 19, 09:00' })).toBeInTheDocument();
  });

  it('opens Settings → Supervisor from the menu', () => {
    const onOpenSettings = vi.fn();
    render(<QuickAccess currentPath={null} onOpenSettings={onOpenSettings} />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Supervisor Permissions…' }));
    expect(onOpenSettings).toHaveBeenCalledWith('supervisor');
  });

  it('edits its skills in a Quick Access dialog without provider or permission choices', async () => {
    render(<QuickAccess currentPath={null} />);
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Quick Access Settings' }));

    const dialog = await screen.findByRole('dialog', { name: 'Quick Access: Supervisor' });
    fireEvent.click(within(dialog).getByTestId('quick-access-add-skill'));
    fireEvent.change(within(dialog).getByLabelText('Skill 1 name'), {
      target: { value: 'Ping' },
    });
    fireEvent.change(within(dialog).getByLabelText('Skill 1 prompt'), {
      target: { value: 'Ask project-a to reply PONG' },
    });
    expect(within(dialog).getByLabelText('Skill 1 model')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Skill 1 provider')).toBeNull();
    expect(within(dialog).queryByLabelText('Skill 1 permission mode')).toBeNull();
    // Nothing from disk (the supervisor loads none), only the Settings → Skills library.
    expect(within(dialog).queryByTestId('quick-access-discovery-project')).toBeNull();
    expect(within(dialog).queryByTestId('quick-access-discovery-user')).toBeNull();
    expect(within(dialog).queryByText(/combos/i)).toBeNull();

    fireEvent.click(within(dialog).getByTestId('quick-access-settings-save'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadSupervisorPresets().skills).toEqual([
      expect.objectContaining({ label: 'Ping', prompt: 'Ask project-a to reply PONG' }),
    ]);
    expect(localStorage.getItem(APP_CONFIG_KEYS.supervisorQuickAccess)).toContain('Ping');
  });

  describe('its wheel', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    async function dwellOpen() {
      fireEvent.pointerEnter(screen.getByTestId('quick-access-supervisor-item'));
      // Two steps: the dots timer schedules the open timer only once it has rendered.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }

    it('puts a skill on a slot from the plus, then launches it from there', async () => {
      saveSupervisorPresets({ skills: [status], wheelSlots: [] });
      render(<QuickAccess currentPath={null} />);
      await dwellOpen();
      expect(screen.getByTestId('quick-access-wheel-supervisor')).toHaveAttribute(
        'data-phase',
        'open'
      );

      fireEvent.click(screen.getByTestId('quick-access-wheel-slot-supervisor-0'));
      fireEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Status round' })
      );
      expect(loadSupervisorPresets().wheelSlots[0]).toBe('sk-status');

      await dwellOpen();
      fireEvent.click(screen.getByTestId('quick-access-wheel-slot-supervisor-0'));
      await waitFor(() => expect(spawnAgent).toHaveBeenCalledTimes(1));
      expect(spawnAgent.mock.calls[0][0].task).toMatch(/Ask every project for its build status$/);
    });

    it('offers to configure skills when there are none', async () => {
      render(<QuickAccess currentPath={null} />);
      await dwellOpen();
      fireEvent.click(screen.getByTestId('quick-access-wheel-slot-supervisor-0'));
      fireEvent.click(
        within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Configure skills…' })
      );
      expect(await screen.findByRole('dialog', { name: 'Quick Access: Supervisor' })).toBeVisible();
    });
  });
});

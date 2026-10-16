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

const { spawnAgent, supervisorPolicyGet } = vi.hoisted(() => ({
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

  it('sends a skill to the running supervisor as a message', async () => {
    saveSupervisorPresets({ skills: [status], wheelSlots: [] });
    const sendAgentInput = vi.fn(async () => undefined);
    useStore.setState({ agents: [running], sendAgentInput });
    const onSelectAgent = vi.fn();
    render(<QuickAccess currentPath={null} onSelectAgent={onSelectAgent} />);

    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Status round' }));

    await waitFor(() => expect(onSelectAgent).toHaveBeenCalledWith('sup-running'));
    expect(sendAgentInput).toHaveBeenCalledWith(
      'sup-running',
      'Ask every project for its build status\r'
    );
    expect(spawnAgent).not.toHaveBeenCalled();
    expect(useStore.getState().toasts.at(-1)?.message).toBe(
      'Sent "Status round" to the running supervisor'
    );
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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { Notification } from '@/lib/notifications/types';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { NotificationsSidebar } from './NotificationsSidebar';

/**
 * Closes the gap the unit tests leave open: `execute.test.ts` proves
 * `executeNotificationAction` calls the right deps when *handed* them, and
 * `useNotificationActions` wires those deps to the real store, but nothing
 * else mounts the sidebar the user actually clicks in. That seam — a row in
 * the tray → real store mutation → dialog actually open / combo actually
 * spawning — is what this file exercises. Only the Tauri IPC boundary is
 * mocked, exactly the modules `execute.ts`/`skillComboSlice.ts` reach through;
 * everything above that is the production wiring.
 */

const spawnAgentMock = vi.fn(async (config: { name: string; model: string; task: string }) => ({
  id: `agent-${spawnAgentMock.mock.calls.length + 1}`,
  name: config.name,
  model: config.model,
  provider: 'claude',
  status: 'running' as const,
  currentTask: config.task,
  startedAt: 1000,
  repoPath: '/repo/sample',
}));

const isDirMock = vi.fn(async (path: string) => path === '/repo/sample');

vi.mock('@/lib/tauri/agents', () => ({
  spawnAgent: (config: unknown) => spawnAgentMock(config as never),
  killAgent: vi.fn(async () => undefined),
  killAgentsForRepo: vi.fn(async () => 0),
  listAgentPromptHistory: vi.fn(async () => []),
  listAgents: vi.fn(async () => []),
  listInterruptedAgents: vi.fn(async () => []),
  recordAgentPromptHistory: vi.fn(async () => undefined),
  renameAgent: vi.fn(async () => undefined),
  resumeInterruptedAgent: vi.fn(async () => {
    throw new Error('not used in this test');
  }),
  discardInterruptedAgent: vi.fn(async () => undefined),
  sendToAgent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/tauri/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/fs')>();
  return { ...actual, isDir: (path: string) => isDirMock(path) };
});

vi.mock('@/lib/tauri/schedules', () => ({
  schedulesList: vi.fn(async () => []),
  schedulesUpsert: vi.fn(async (schedule: unknown) => schedule),
  schedulesDelete: vi.fn(async () => undefined),
  schedulesSetEnabled: vi.fn(async () => undefined),
  schedulesPreview: vi.fn(async () => []),
}));

vi.mock('@/lib/tauri/notifications', () => ({
  notificationsDispatch: vi.fn(async () => {
    throw new Error('not used in this test');
  }),
  notificationsList: vi.fn(async () => []),
  notificationsMarkRead: vi.fn(async () => undefined),
  notificationsMarkAllRead: vi.fn(async () => undefined),
  notificationsAnswer: vi.fn(async () => undefined),
  notificationsClear: vi.fn(async () => undefined),
}));

const REPO_PATH = '/repo/sample';

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    models: [
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
    ],
    permissionModes: [
      { value: 'plan', label: 'Plan', description: 'Plan only' },
      { value: 'default', label: 'Interactive', description: 'Ask for permissions' },
    ],
    defaultModel: 'sonnet',
    defaultPermissionMode: 'default',
  },
];

const starredWithPins: StarredProject = {
  path: REPO_PATH,
  name: 'sample',
  starredAt: 1,
  skills: [
    {
      id: 'skill-1',
      label: 'Changelog',
      prompt: '/changelog',
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan',
    },
  ],
  combos: [
    {
      id: 'combo-1',
      label: 'Blog-Write',
      steps: [
        {
          id: 'step-1',
          label: 'Draft',
          prompt: '/draft',
          providerId: 'claude',
          model: 'opus',
          permissionMode: 'plan',
        },
        {
          id: 'step-2',
          label: 'Polish',
          prompt: 'tighten the wording',
          providerId: 'claude',
          model: 'opus',
        },
      ],
    },
  ],
};

let uidCounter = 0;

function makeNotification(overrides: Partial<Notification>): Notification {
  uidCounter += 1;
  return {
    id: uidCounter,
    uid: `n-${uidCounter}`,
    createdAt: new Date().toISOString(),
    projectPath: REPO_PATH,
    projectName: 'sample',
    source: 'system',
    origin: 'Weekly changelog',
    kind: 'info',
    severity: 'info',
    title: 'Weekly changelog',
    body: null,
    actions: [],
    dedupeKey: null,
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

function resetStore() {
  useStore.setState({
    notifications: [],
    notificationsUnreadCount: 0,
    notificationsStatus: 'idle',
    schedules: [],
    starredProjects: [],
    comboRuns: [],
    spawnDialogOpen: false,
    initialAgentTask: '',
    spawnAgentRepoPath: null,
    spawnAgentPreset: null,
    spawnAgentTicketId: null,
    spawnAgentGoalId: null,
    rootPath: null,
    // A previous test's real conductor run must not bleed into the next one.
    conductorRunning: false,
    conductorAssignments: {},
    conductorReviewAssignments: {},
    pmDraftTickets: [],
    goalsDraft: [],
    pmLoading: false,
    goalsLoading: false,
    workPlaceOpen: false,
    commandCenterOpen: false,
    commandCenterProject: undefined,
    toasts: [],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  isDirMock.mockImplementation(async (path: string) => path === REPO_PATH);
  resetStore();
});

describe('NotificationsSidebar — scheduled skill/combo click, end to end', () => {
  it('run-skill: opens the spawn dialog prefilled from the snapshot, and does not spawn', async () => {
    const user = userEvent.setup();
    useStore.setState({ starredProjects: [starredWithPins] } as never);
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Start Changelog',
          kind: 'run-skill',
          skillId: 'skill-1',
          skillLabel: 'Changelog',
          prompt: '/changelog',
          repoPath: REPO_PATH,
          providerId: 'claude',
          model: 'opus',
          permissionMode: 'plan',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(useStore.getState().spawnDialogOpen).toBe(true));
    expect(useStore.getState().initialAgentTask).toBe('/changelog');
    expect(useStore.getState().spawnAgentRepoPath).toBe(REPO_PATH);
    expect(useStore.getState().spawnAgentPreset).toEqual({
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan',
    });

    expect(spawnAgentMock).not.toHaveBeenCalled();
    expect(useStore.getState().comboRuns).toHaveLength(0);

    // Clicking settled the notification too — the read-effect is not skipped
    // just because the payload effect is a dialog open, not a spawn.
    expect(useStore.getState().notifications[0]?.readAt).not.toBeNull();
  });

  // The frictionless path, end to end: the reminder arrives, one click, the
  // agent is running with the permission the skill was pinned to — no second
  // dialog confirming what the schedule already said.
  it('run-skill with a direct start: spawns from the snapshot and shows the agent', async () => {
    const user = userEvent.setup();
    useStore.setState({ starredProjects: [starredWithPins], providers: PROVIDERS } as never);
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Start Changelog',
          kind: 'run-skill',
          skillId: 'skill-1',
          skillLabel: 'Changelog',
          prompt: '/changelog',
          repoPath: REPO_PATH,
          providerId: 'claude',
          model: 'opus',
          permissionMode: 'plan',
          launch: 'direct',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(spawnAgentMock).toHaveBeenCalledTimes(1));
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: '/changelog',
        cwd: REPO_PATH,
        provider: 'claude',
        model: 'opus',
        permissionMode: 'plan',
      })
    );
    expect(useStore.getState().spawnDialogOpen).toBe(false);

    // Started and selected: the terminal is showing the run this click began.
    await waitFor(() =>
      expect(useStore.getState().selectedAgentId).toBe(useStore.getState().agents[0]?.id)
    );
    expect(useStore.getState().selectedAgentId).toBeTruthy();
  });

  // The same payload shape can arrive from a running model. Skipping the
  // dialog is a decision only the person clicking gets to make.
  it('run-skill with a direct start from an agent: falls back to the dialog', async () => {
    const user = userEvent.setup();
    useStore.setState({ starredProjects: [starredWithPins], providers: PROVIDERS } as never);
    const notification = makeNotification({
      source: 'agent',
      actions: [
        {
          id: 'run',
          label: 'Start Changelog',
          kind: 'run-skill',
          skillId: 'skill-1',
          skillLabel: 'Changelog',
          prompt: '/changelog',
          repoPath: REPO_PATH,
          providerId: 'claude',
          launch: 'direct',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(useStore.getState().spawnDialogOpen).toBe(true));
    expect(spawnAgentMock).not.toHaveBeenCalled();
  });

  it('spawn-agent from an agent payload: the permission mode in it is ignored', async () => {
    const user = userEvent.setup();
    const notification = makeNotification({
      source: 'agent',
      actions: [
        {
          id: 'run',
          label: 'Agent starten',
          kind: 'spawn-agent',
          task: 'Serverscan durchführen',
          repoPath: REPO_PATH,
          permissionMode: 'bypassPermissions',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);
    await user.click(await screen.findByTestId(`notification-action-${notification.uid}-run`));

    await waitFor(() => expect(spawnAgentMock).toHaveBeenCalledTimes(1));
    expect(spawnAgentMock.mock.calls[0][0]).not.toMatchObject({
      permissionMode: 'bypassPermissions',
    });
  });

  it('spawn-agent from a schedule: runs with the permission the schedule names', async () => {
    const user = userEvent.setup();
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Agent starten',
          kind: 'spawn-agent',
          task: 'Serverscan durchführen',
          repoPath: REPO_PATH,
          provider: 'claude',
          model: 'opus',
          permissionMode: 'acceptEdits',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);
    await user.click(await screen.findByTestId(`notification-action-${notification.uid}-run`));

    await waitFor(() => expect(spawnAgentMock).toHaveBeenCalledTimes(1));
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        model: 'opus',
        permissionMode: 'acceptEdits',
      })
    );
  });

  it('run-combo: starts the real chain via startSkillCombo, spawning step 0 for real', async () => {
    const user = userEvent.setup();
    useStore.setState({ starredProjects: [starredWithPins] } as never);
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Start Blog-Write',
          kind: 'run-combo',
          comboId: 'combo-1',
          comboLabel: 'Blog-Write',
          repoPath: REPO_PATH,
          steps: [
            { id: 'step-1', label: 'Draft', prompt: '/draft', providerId: 'claude', model: 'opus' },
            { id: 'step-2', label: 'Polish', prompt: 'tighten the wording', providerId: 'claude' },
          ],
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(spawnAgentMock).toHaveBeenCalledTimes(1));
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: '/draft', cwd: REPO_PATH })
    );

    await waitFor(() => expect(useStore.getState().comboRuns).toHaveLength(1));
    const run = useStore.getState().comboRuns[0];
    expect(run.comboId).toBe('combo-1');
    expect(run.projectPath).toBe(REPO_PATH);
    expect(run.currentAgentId).not.toBeNull();

    // The combo path must never fall through to the skill dialog.
    expect(useStore.getState().spawnDialogOpen).toBe(false);
  });

  it('spawn-agent (Freitext-Agent): still spawns immediately, unchanged (I4 regression)', async () => {
    const user = userEvent.setup();
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Agent starten',
          kind: 'spawn-agent',
          task: 'Serverscan durchführen',
          repoPath: REPO_PATH,
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await user.click(button);

    await waitFor(() => expect(spawnAgentMock).toHaveBeenCalledTimes(1));
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Serverscan durchführen', cwd: REPO_PATH })
    );
    expect(useStore.getState().spawnDialogOpen).toBe(false);
    expect(useStore.getState().comboRuns).toHaveLength(0);
  });

  it('run-skill against a vanished project folder: the button disables itself once probed', async () => {
    isDirMock.mockImplementation(async (path: string) => path !== '/repo/gone');
    const notification = makeNotification({
      projectPath: '/repo/gone',
      actions: [
        {
          id: 'run',
          label: 'Start Changelog',
          kind: 'run-skill',
          skillId: 'skill-1',
          skillLabel: 'Changelog',
          prompt: '/changelog',
          repoPath: '/repo/gone',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('title', 'Project folder not found');

    expect(spawnAgentMock).not.toHaveBeenCalled();
    expect(useStore.getState().spawnDialogOpen).toBe(false);
  });
});

describe('NotificationsSidebar — run-conductor click, end to end', () => {
  it('direct, already-open project: starts the run for real, no switch prompt', async () => {
    const user = userEvent.setup();
    useStore.setState({ rootPath: REPO_PATH } as never);
    const notification = makeNotification({
      origin: 'Nightly A',
      actions: [
        {
          id: 'run',
          label: 'Start',
          kind: 'run-conductor',
          repoPath: REPO_PATH,
          ticketBudget: 5,
          launch: 'direct',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);
    const onOpenProject = vi.fn(async () => undefined);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={onOpenProject} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() =>
      expect(useStore.getState().toasts.some((t) => t.message.includes('Conductor started'))).toBe(
        true
      )
    );
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(useStore.getState().rootPath).toBe(REPO_PATH);
    // Clicking settled the notification, same as every other action kind.
    // (The conductor's own "run finished" notification lands at index 0 by
    // now, since this run has no tickets to work — find ours by uid.)
    const settled = useStore.getState().notifications.find((n) => n.uid === notification.uid);
    expect(settled?.readAt).not.toBeNull();
  });

  it('dialog mode: pre-fills and opens the Conductor panel instead of starting', async () => {
    const user = userEvent.setup();
    useStore.setState({ rootPath: REPO_PATH } as never);
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Start',
          kind: 'run-conductor',
          repoPath: REPO_PATH,
          ticketBudget: 4,
          maxConcurrent: 2,
          requireReview: true,
          goalId: 'g1',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);

    render(
      <NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn(async () => undefined)} />
    );

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(useStore.getState().workPlaceOpen).toBe(true));
    expect(useStore.getState().workTab).toBe('goals');
    expect(useStore.getState().selectedGoalId).toBe('g1');
    expect(useStore.getState().conductorMaxConcurrent).toBe(2);
    expect(useStore.getState().conductorRequireReview).toBe(true);
    expect(useStore.getState().conductorRunning).toBe(false);
  });

  it('targeting a different project: asks first, and a decline starts nothing', async () => {
    const user = userEvent.setup();
    useStore.setState({ rootPath: '/repo/other' } as never);
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Start',
          kind: 'run-conductor',
          repoPath: REPO_PATH,
          ticketBudget: 3,
          launch: 'direct',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);
    const onOpenProject = vi.fn(async () => undefined);

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={onOpenProject} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    expect(button).toHaveTextContent('Open project & start');
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onOpenProject).not.toHaveBeenCalled();
    expect(useStore.getState().rootPath).toBe('/repo/other');
    // The click itself already settled the notification — same as every other
    // action kind (the confirm gates the *effect*, not the recorded decision).
    expect(useStore.getState().notifications[0]?.readAt).not.toBeNull();
  });

  it('targeting a different project: confirming opens it, then starts', async () => {
    const user = userEvent.setup();
    useStore.setState({ rootPath: '/repo/other' } as never);
    const notification = makeNotification({
      actions: [
        {
          id: 'run',
          label: 'Start',
          kind: 'run-conductor',
          repoPath: REPO_PATH,
          ticketBudget: 2,
          launch: 'direct',
        },
      ],
    });
    useStore.setState({ notifications: [notification] } as never);
    const onOpenProject = vi.fn(async (path: string) => {
      useStore.setState({ rootPath: path, pmLoading: false, goalsLoading: false } as never);
    });

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={onOpenProject} />);

    const button = await screen.findByTestId(`notification-action-${notification.uid}-run`);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await user.click(await screen.findByRole('button', { name: 'Open & start' }));

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(REPO_PATH));
    await waitFor(() =>
      expect(useStore.getState().toasts.some((t) => t.message.includes('Conductor started'))).toBe(
        true
      )
    );
  });
});

describe('NotificationsSidebar — the way out of the glance', () => {
  it('opens the Command Center from the header button', async () => {
    const user = userEvent.setup();

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);
    await user.click(screen.getByTestId('notifications-open-center'));

    expect(useStore.getState().commandCenterOpen).toBe(true);
    // Opened from the tray, so nothing is preselected — the center starts on
    // "All" rather than on whichever project was last drilled into.
    expect(useStore.getState().commandCenterProject).toBeUndefined();
  });

  it('loads the schedules it names, without a project being open', async () => {
    const { schedulesList } = await import('@/lib/tauri/schedules');

    render(<NotificationsSidebar onRunCommand={vi.fn()} onOpenProject={vi.fn()} />);

    await waitFor(() => expect(schedulesList).toHaveBeenCalled());
    expect(screen.getByTestId('notifications-next-schedule')).toHaveTextContent('No schedules');
  });
});

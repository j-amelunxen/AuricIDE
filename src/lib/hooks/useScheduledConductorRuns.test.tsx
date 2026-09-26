import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { UNATTENDED_AFTER_MS } from '@/lib/conductor/scheduledRun';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { Notification } from '@/lib/notifications/types';
import type { Tab } from '@/lib/store/tabsSlice';
import type { PmTicket } from '@/lib/tauri/pm';

// idleForMs' own timing behaviour is covered by userActivity.test.ts; here the
// hook only needs a controllable value to drive the gate.
const mockIdleForMs = vi.fn(() => UNATTENDED_AFTER_MS);
const mockUninstall = vi.fn();
const mockInstall = vi.fn((_target: Window | Document) => mockUninstall);
vi.mock('@/lib/ide/userActivity', () => ({
  installUserActivityTracker: (target: Window | Document) => mockInstall(target),
  idleForMs: () => mockIdleForMs(),
}));

const mockIsDir = vi.fn(async (_path: string) => true);
vi.mock('@/lib/tauri/fs', () => ({
  isDir: (path: string) => mockIsDir(path),
}));

// The native launch claim (Rust, notifications.db) is the atomic gate before
// an automatic start; here it is a controllable stand-in.
const mockClaim = vi.fn(async (_input: Record<string, unknown>) => 'claimed');
const mockRelease = vi.fn(async (_uid: string) => undefined);
// The grant table in the inbox db, shared by "all app instances" in a test.
const grantTable = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const mockListGrants = vi.fn(async (_projectPath?: string) => grantTable.rows);
const mockSaveGrant = vi.fn(async (input: Record<string, unknown>) => {
  const row = { ...input, grantedAt: '2026-09-26 10:00:00', launchesUsed: 0 };
  grantTable.rows = [...grantTable.rows.filter((g) => g.rootGoalId !== input.rootGoalId), row];
  return row;
});
// `notifications-changed`: the inbox file changed, maybe in another instance.
const inboxChanged = vi.hoisted(() => ({ fire: () => undefined as void }));
vi.mock('@/lib/tauri/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/notifications')>()),
  notificationsClaimLaunch: (input: Record<string, unknown>) => mockClaim(input),
  notificationsReleaseLaunchClaim: (uid: string) => mockRelease(uid),
  notificationsListLaunchGrants: (projectPath?: string) => mockListGrants(projectPath),
  notificationsSaveLaunchGrant: (input: Record<string, unknown>) => mockSaveGrant(input),
  onNotificationsChanged: (callback: () => void) => {
    inboxChanged.fire = callback;
    return () => undefined;
  },
}));

import { useStore } from '@/lib/store';
import { LAUNCH_RETRY_MS, useScheduledConductorRuns } from './useScheduledConductorRuns';

const REPO = '/tmp/project-a';
const OTHER_REPO = '/tmp/project-b';

// The hook reads the real clock (it does not take an injected `now`), so a
// "fresh" fixture has to be fresh relative to whenever the test actually
// runs, not a date frozen at fixture-writing time.
function freshDedupeKey(): string {
  const iso = new Date().toISOString(); // 'YYYY-MM-DDTHH:MM:SS.sssZ'
  return `schedule:s1:${iso.slice(0, 19).replace('T', ' ')}`;
}

function autoAgentNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 2,
    uid: 'n-agent',
    createdAt: '2026-08-17 09:30:00',
    projectPath: null,
    projectName: null,
    source: 'system',
    origin: 'Nightly scan',
    kind: 'info',
    severity: 'info',
    title: 'Scheduled agent',
    body: null,
    actions: [
      {
        id: 'run',
        label: 'Start agent',
        kind: 'spawn-agent',
        task: 'scan',
        repoPath: REPO,
        launch: 'auto',
        headless: true,
      },
    ],
    dedupeKey: freshDedupeKey(),
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

function autoNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    uid: 'n1',
    createdAt: '2026-08-17 09:30:00',
    projectPath: null,
    projectName: null,
    source: 'system',
    origin: 'Nightly A',
    kind: 'info',
    severity: 'info',
    title: 'Scheduled run',
    body: null,
    actions: [
      {
        id: 'start',
        label: 'Start',
        kind: 'run-conductor',
        repoPath: REPO,
        ticketBudget: 5,
        launch: 'auto',
      },
    ],
    dedupeKey: freshDedupeKey(),
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

/** One open, unblocked ticket — otherwise every launch below skips the cycle. */
function readyTicket(): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Ready ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
  };
}

function tab(isDirty: boolean): Tab {
  return { id: 't1', path: '/f.md', name: 'f.md', isDirty };
}

function agent(status: AgentInfo['status']): AgentInfo {
  return { id: 'a1', name: 'agent', status, model: 'sonnet', provider: 'claude', startedAt: 0 };
}

describe('useScheduledConductorRuns', () => {
  let startConductor: Mock;
  let conductorTick: Mock<() => Promise<void>>;
  let markNotificationRead: Mock<() => Promise<void>>;
  let showToast: Mock;
  let openProject: Mock<(path: string) => Promise<void>>;
  let spawnNewAgent: Mock;
  let selectAgent: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIdleForMs.mockReturnValue(UNATTENDED_AFTER_MS);
    mockIsDir.mockResolvedValue(true);

    startConductor = vi.fn();
    conductorTick = vi.fn(async () => undefined);
    markNotificationRead = vi.fn(async () => undefined);
    showToast = vi.fn();
    openProject = vi.fn(async () => undefined);
    spawnNewAgent = vi.fn(async () => ({ id: 'spawned-1', name: 'scan' }));
    selectAgent = vi.fn();

    useStore.setState({
      notifications: [],
      rootPath: REPO,
      pmLoading: false,
      goalsLoading: false,
      conductorRunning: false,
      pmDraftTickets: [readyTicket()],
      pmDraftDependencies: [],
      goalsDraft: [],
      agents: [],
      openTabs: [],
      providers: [],
      startConductor,
      conductorTick,
      markNotificationRead,
      showToast,
      spawnNewAgent,
      selectAgent,
    });
  });

  it('installs the activity tracker once on mount', () => {
    renderHook(() => useScheduledConductorRuns(openProject));
    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it('starts a trusted, fresh auto launch for the already-open project', async () => {
    useStore.setState({ notifications: [autoNotification()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(startConductor).toHaveBeenCalled());

    expect(openProject).not.toHaveBeenCalled();
    expect(startConductor).toHaveBeenCalledWith(null, {
      ticketBudget: 5,
      maxConcurrent: 1,
      requireReview: false,
      origin: 'Nightly A',
    });
    expect(conductorTick).toHaveBeenCalled();
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('skips the cycle when the backlog has nothing ready, and says so', async () => {
    // The nightly run comes round whether or not anyone filed work. Starting
    // anyway would either finish instantly or — with a backlog of nothing but
    // blocked tickets — park a run that never ends and holds out every later
    // schedule behind `conductor-running`.
    useStore.setState({ pmDraftTickets: [], notifications: [autoNotification()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(startConductor).not.toHaveBeenCalled();
    expect(conductorTick).not.toHaveBeenCalled();
    // Read all the same: the occurrence was handled, it just had no work.
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    expect(String(showToast.mock.calls[0][0])).toContain('Nightly A');
  });

  it('does nothing for a stale occurrence', async () => {
    useStore.setState({
      notifications: [autoNotification({ dedupeKey: 'schedule:s1:2020-01-01 00:00:00' })],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await Promise.resolve();

    expect(startConductor).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('does nothing for a payload written by an agent', async () => {
    useStore.setState({ notifications: [autoNotification({ source: 'agent' })] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await Promise.resolve();

    expect(startConductor).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('refuses and toasts, without marking read, when the conductor is already running', async () => {
    useStore.setState({ conductorRunning: true, notifications: [autoNotification()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(startConductor).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
    expect(showToast.mock.calls[0][0]).toContain('Nightly A');
  });

  it('opens a different, idle, clean project before starting', async () => {
    useStore.setState({
      rootPath: OTHER_REPO,
      openTabs: [],
      notifications: [autoNotification()],
    });
    openProject.mockImplementation(async (path: string) => {
      useStore.setState({ rootPath: path, pmLoading: false, goalsLoading: false });
    });

    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(startConductor).toHaveBeenCalled());

    expect(openProject).toHaveBeenCalledWith(REPO);
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
  });

  it('refuses a switch away from a different project with unsaved tabs', async () => {
    useStore.setState({
      rootPath: OTHER_REPO,
      openTabs: [tab(true)],
      notifications: [autoNotification()],
    });

    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(openProject).not.toHaveBeenCalled();
    expect(startConductor).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('refuses while an implementer agent is running', async () => {
    useStore.setState({ agents: [agent('running')], notifications: [autoNotification()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(startConductor).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('considers a queued agent as running too', async () => {
    useStore.setState({ agents: [agent('queued')], notifications: [autoNotification()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(startConductor).not.toHaveBeenCalled();
  });

  it('only attempts a given notification once, even across re-renders', async () => {
    useStore.setState({ notifications: [autoNotification()] });
    const { rerender } = renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(startConductor).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    expect(startConductor).toHaveBeenCalledTimes(1);
  });

  it('starts a trusted, fresh spawn-agent auto launch without switching project', async () => {
    // Attended on purpose: a custom-agent auto launch never waits for an
    // unattended IDE, unlike a conductor run.
    mockIdleForMs.mockReturnValue(0);
    useStore.setState({
      rootPath: OTHER_REPO,
      notifications: [autoAgentNotification()],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalled());

    expect(openProject).not.toHaveBeenCalled();
    expect(startConductor).not.toHaveBeenCalled();
    expect(spawnNewAgent).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'scan', cwd: REPO, headless: true })
    );
    expect(selectAgent).not.toHaveBeenCalled();
    expect(markNotificationRead).toHaveBeenCalledWith('n-agent');
  });

  it('starts an agent auto launch even while you are typing and another agent runs', async () => {
    mockIdleForMs.mockReturnValue(0);
    useStore.setState({
      agents: [agent('running')],
      openTabs: [tab(true)],
      conductorRunning: true,
      notifications: [autoAgentNotification()],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalled());

    expect(openProject).not.toHaveBeenCalled();
    expect(selectAgent).not.toHaveBeenCalled();
  });

  it('does not auto-start a stale agent occurrence', async () => {
    useStore.setState({
      notifications: [autoAgentNotification({ dedupeKey: 'schedule:s1:2020-01-01 00:00:00' })],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await Promise.resolve();

    expect(spawnNewAgent).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('starts a run-skill auto launch without opening the spawn dialog', async () => {
    useStore.setState({
      notifications: [
        autoAgentNotification({
          uid: 'n-skill',
          actions: [
            {
              id: 'run',
              label: 'Start Changelog',
              kind: 'run-skill',
              skillId: 's1',
              skillLabel: 'Changelog',
              prompt: '/changelog',
              repoPath: REPO,
              launch: 'auto',
              headless: true,
            },
          ],
        }),
      ],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalled());

    expect(spawnNewAgent).toHaveBeenCalledWith(
      expect.objectContaining({ task: '/changelog', cwd: REPO, headless: true })
    );
    expect(selectAgent).not.toHaveBeenCalled();
    expect(markNotificationRead).toHaveBeenCalledWith('n-skill');
  });
});

describe('useScheduledConductorRuns: launch requests under a grant', () => {
  const ROOT = 'goal-root';
  const SUB = 'goal-sub';
  let spawnNewAgent: Mock;
  let markNotificationRead: Mock<() => Promise<void>>;
  let answerNotification: Mock;
  let showToast: Mock;
  const openProject = vi.fn(async () => undefined);

  function launchRequest(overrides: Partial<Notification> = {}, goalId = SUB): Notification {
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return {
      id: 7,
      uid: 'req-1',
      createdAt,
      projectPath: REPO,
      projectName: 'project-a',
      source: 'agent',
      origin: 'request_agent_launch',
      kind: 'info',
      severity: 'info',
      title: 'Agent requested',
      body: null,
      actions: [
        {
          id: 'start',
          label: 'Start agent',
          kind: 'spawn-agent',
          task: 'work on it',
          repoPath: REPO,
          goalId,
          // Forged authority: must not reach the launch.
          permissionMode: 'bypassPermissions',
          launch: 'auto',
          headless: true,
        },
      ],
      dedupeKey: `agent-launch:${overrides.uid ?? 'req-1'}`,
      refKind: 'goal',
      refId: goalId,
      readAt: null,
      answeredAt: null,
      answer: null,
      expiresAt: null,
      ...overrides,
    };
  }

  function grantMission(overrides: Record<string, unknown> = {}) {
    grantTable.rows = [
      {
        id: 'g1',
        projectPath: REPO,
        rootGoalId: ROOT,
        rootGoalName: 'Mission',
        maxConcurrent: 1,
        launchBudget: 3,
        grantedAt: '2026-09-26 10:00:00',
        launchesUsed: 0,
        ...overrides,
      },
    ];
  }

  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    grantTable.rows = [];
    mockClaim.mockImplementation(async () => 'claimed');
    mockRelease.mockImplementation(async () => undefined);
    mockListGrants.mockImplementation(async () => grantTable.rows);
    spawnNewAgent = vi.fn(async () => ({ id: 'agent-9', name: 'work' }));
    markNotificationRead = vi.fn(async () => undefined);
    answerNotification = vi.fn(async () => undefined);
    showToast = vi.fn();
    useStore.setState({
      notifications: [],
      rootPath: REPO,
      conductorRunning: false,
      goalsDraft: [
        { id: ROOT, parentId: null } as never,
        { id: SUB, parentId: ROOT } as never,
        { id: 'elsewhere', parentId: null } as never,
      ],
      agents: [],
      openTabs: [],
      providers: [],
      markNotificationRead,
      answerNotification,
      showToast,
      spawnNewAgent,
      selectAgent: vi.fn(),
    });
  });

  it('starts a request under a granted root, as foreign, bound to the goal', async () => {
    grantMission();
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalled());

    const config = spawnNewAgent.mock.calls[0][0];
    expect(config).toMatchObject({
      task: 'work on it',
      cwd: REPO,
      spawnedByGoalId: SUB,
      launchRequestUid: 'req-1',
    });
    expect(config.permissionMode).not.toBe('bypassPermissions');
    expect(config.headless).not.toBe(true);
    expect(markNotificationRead).toHaveBeenCalledWith('req-1');
    // Only the ids: limits, project and root come from the grant row natively.
    expect(mockClaim).toHaveBeenCalledWith({ requestUid: 'req-1', grantId: 'g1' });
    expect(mockClaim.mock.invocationCallOrder[0]).toBeLessThan(
      spawnNewAgent.mock.invocationCallOrder[0]
    );
  });

  it('records which agent the request started', async () => {
    grantMission();
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));

    await vi.waitFor(() =>
      expect(answerNotification).toHaveBeenCalledWith('req-1', 'agent:agent-9')
    );
  });

  it('leaves the request as a button without a grant', async () => {
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await Promise.resolve();
    await Promise.resolve();

    expect(spawnNewAgent).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('leaves a request for another mission as a button', async () => {
    grantMission();
    useStore.setState({ notifications: [launchRequest({}, 'elsewhere')] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await Promise.resolve();
    await Promise.resolve();

    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  it('holds a request back at the limit and starts it once the slot frees up', async () => {
    grantMission();
    useStore.setState({
      agents: [{ ...agent('running'), spawnedByGoalId: ROOT }],
      notifications: [launchRequest()],
    });
    const { rerender } = renderHook(() => useScheduledConductorRuns(openProject));
    await Promise.resolve();
    expect(spawnNewAgent).not.toHaveBeenCalled();

    useStore.setState({ agents: [{ ...agent('idle'), spawnedByGoalId: ROOT }] });
    rerender();
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
  });

  it('does not exceed the limit while a spawn is still in flight', async () => {
    grantMission({ maxConcurrent: 1 });
    let finish: (value: unknown) => void = () => undefined;
    spawnNewAgent.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    useStore.setState({ notifications: [launchRequest()] });
    const { rerender } = renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));

    useStore.setState({
      notifications: [launchRequest(), launchRequest({ uid: 'req-2', id: 8 }, ROOT)],
    });
    rerender();
    await Promise.resolve();
    expect(spawnNewAgent).toHaveBeenCalledTimes(1);
    finish({ id: 'agent-9', name: 'work' });
  });

  // Fault injection: the spawn itself fails.
  it('books the attempt, reports the failure and records it on the request', async () => {
    grantMission();
    spawnNewAgent.mockRejectedValue(new Error("Provider 'nope' is not installed"));
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));

    await vi.waitFor(() =>
      expect(answerNotification).toHaveBeenCalledWith(
        'req-1',
        expect.stringMatching(/^failed:.*not installed/)
      )
    );
    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    await vi.waitFor(() => expect(mockRelease).toHaveBeenCalledWith('req-1'));
  });

  it('stops at the budget', async () => {
    grantMission({ launchesUsed: 3 });
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();

    expect(mockClaim).not.toHaveBeenCalled();
    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  // The native claim decides last, atomically and across app instances.
  it.each([
    'already-claimed',
    'at-capacity',
    'budget-spent',
    'not-a-request',
    'no-grant',
    'outside-root',
  ])('starts nothing when the native claim answers %s', async (outcome) => {
    grantMission();
    mockClaim.mockImplementation(async () => outcome);
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(mockClaim).toHaveBeenCalled());
    await settle();

    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  // Fault injection: the claim cannot be made at all (IPC or database error).
  it('starts nothing when the claim fails, and says so', async () => {
    grantMission();
    mockClaim.mockRejectedValue(new Error('database is locked'));
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    await settle();

    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  // Fault injection: the grant rows cannot be read; nothing starts.
  it('starts nothing while the grants cannot be read', async () => {
    grantMission();
    mockListGrants.mockRejectedValue(new Error('no db'));
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();

    expect(mockClaim).not.toHaveBeenCalled();
    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  // Review r2 (5): transient failures must not block a request for good.
  it('retries after a failed grant read, without any other event', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    grantMission();
    mockListGrants.mockRejectedValueOnce(new Error('database is locked'));
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();
    expect(spawnNewAgent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LAUNCH_RETRY_MS);

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
  });

  it('retries after a failed claim, without any other event', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    grantMission();
    mockClaim.mockRejectedValueOnce(new Error('database is locked'));
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(spawnNewAgent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LAUNCH_RETRY_MS);

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
    expect(mockClaim).toHaveBeenCalledTimes(2);
  });

  // Another app instance holds the last slot; it frees it there, which this
  // instance's store never sees. The retry picks it up.
  it('starts once another instance frees the slot, without a change in this store', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    grantMission();
    mockClaim.mockResolvedValueOnce('at-capacity');
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
    await settle();
    expect(spawnNewAgent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LAUNCH_RETRY_MS);

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
  });

  it('does not hammer the claim while a request is held back', async () => {
    grantMission();
    mockClaim.mockResolvedValue('at-capacity');
    useStore.setState({ notifications: [launchRequest()] });
    const { rerender } = renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 5; i += 1) {
      inboxChanged.fire();
      rerender();
      await settle();
    }
    expect(mockClaim).toHaveBeenCalledTimes(1);
  });

  // REQ-LAUNCH-01 across instances: a revoke acknowledged elsewhere reaches
  // this instance through the inbox file, and the claim itself refuses a
  // grant id that is no longer in force.
  it('stops starting after a revoke in another instance', async () => {
    grantMission();
    useStore.setState({ notifications: [] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();
    grantTable.rows = [];
    inboxChanged.fire();
    await settle();
    useStore.setState({ notifications: [launchRequest()] });
    await settle();

    expect(mockClaim).not.toHaveBeenCalled();
    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  it('holds a waiting request back after a revocation, without any other change', async () => {
    grantMission({ maxConcurrent: 1 });
    useStore.setState({
      agents: [{ ...agent('running'), spawnedByGoalId: ROOT }],
      notifications: [launchRequest()],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();
    grantTable.rows = [];
    inboxChanged.fire();
    await settle();
    useStore.setState({ agents: [] });
    await settle();

    expect(spawnNewAgent).not.toHaveBeenCalled();
  });

  // Decision Jennifer 2026-09-26 (and review r2, 4): a request that waited
  // before the grant starts when Jennifer grants, through the real UI save.
  it('starts a request that waited before the grant as soon as the UI saves one', async () => {
    const early = launchRequest({ createdAt: '2026-09-25 08:00:00' });
    useStore.setState({ notifications: [early] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();
    expect(spawnNewAgent).not.toHaveBeenCalled();

    const { saveLaunchGrant } = await import('@/lib/notifications/launchGrants');
    await saveLaunchGrant({
      projectPath: REPO,
      rootGoalId: ROOT,
      rootGoalName: 'Mission',
      maxConcurrent: 1,
      launchBudget: 3,
    });

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
    expect(mockClaim).toHaveBeenCalledWith({
      requestUid: 'req-1',
      grantId: grantTable.rows[0].id,
    });
  });

  it('starts waiting requests on grant only up to the limit', async () => {
    spawnNewAgent.mockImplementation(() => new Promise(() => undefined));
    useStore.setState({
      notifications: [
        launchRequest({ createdAt: '2026-09-25 08:00:00' }),
        launchRequest({ uid: 'req-2', id: 8, createdAt: '2026-09-25 08:01:00' }, ROOT),
      ],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await settle();

    const { saveLaunchGrant } = await import('@/lib/notifications/launchGrants');
    await saveLaunchGrant({
      projectPath: REPO,
      rootGoalId: ROOT,
      rootGoalName: 'Mission',
      maxConcurrent: 1,
      launchBudget: 3,
    });

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
    await settle();
    expect(spawnNewAgent).toHaveBeenCalledTimes(1);
  });

  // Review r1: the next request must not wait for an unrelated event once an
  // in-flight start has resolved.
  it('starts the next request right after an in-flight start fails', async () => {
    grantMission({ maxConcurrent: 1 });
    let fail: () => void = () => undefined;
    spawnNewAgent.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = () => reject(new Error('spawn failed'))))
    );
    useStore.setState({
      notifications: [launchRequest(), launchRequest({ uid: 'req-2', id: 8 }, ROOT)],
    });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
    await settle();
    expect(spawnNewAgent).toHaveBeenCalledTimes(1);

    fail();

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(2));
  });

  // While a spawn resolves, its agent shows up in the store and is still in
  // flight: counted twice for a moment. Once the spawn returns, the free slot
  // has to be seen at once.
  it('starts the next request right after an in-flight start succeeds and a slot is free', async () => {
    grantMission({ maxConcurrent: 2 });
    let succeed: () => void = () => undefined;
    spawnNewAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          succeed = () => resolve({ id: 'agent-9', name: 'work' });
        })
    );
    useStore.setState({ notifications: [launchRequest()] });
    renderHook(() => useScheduledConductorRuns(openProject));
    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(1));
    useStore.setState({
      agents: [{ ...agent('running'), id: 'agent-9', spawnedByGoalId: SUB }],
      notifications: [launchRequest(), launchRequest({ uid: 'req-2', id: 8 }, ROOT)],
    });
    await settle();
    expect(spawnNewAgent).toHaveBeenCalledTimes(1);

    succeed();

    await vi.waitFor(() => expect(spawnNewAgent).toHaveBeenCalledTimes(2));
  });
});

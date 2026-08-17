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

import { useStore } from '@/lib/store';
import { useScheduledConductorRuns } from './useScheduledConductorRuns';

const REPO = '/tmp/project-a';
const OTHER_REPO = '/tmp/project-b';

// The hook reads the real clock (it does not take an injected `now`), so a
// "fresh" fixture has to be fresh relative to whenever the test actually
// runs, not a date frozen at fixture-writing time.
function freshDedupeKey(): string {
  const iso = new Date().toISOString(); // 'YYYY-MM-DDTHH:MM:SS.sssZ'
  return `schedule:s1:${iso.slice(0, 19).replace('T', ' ')}`;
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockIdleForMs.mockReturnValue(UNATTENDED_AFTER_MS);

    startConductor = vi.fn();
    conductorTick = vi.fn(async () => undefined);
    markNotificationRead = vi.fn(async () => undefined);
    showToast = vi.fn();
    openProject = vi.fn(async () => undefined);

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
      startConductor,
      conductorTick,
      markNotificationRead,
      showToast,
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
});

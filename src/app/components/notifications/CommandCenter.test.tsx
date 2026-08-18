import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { Notification } from '@/lib/notifications/types';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import type { Schedule } from '@/lib/tauri/schedules';
import { CommandCenter } from './CommandCenter';

/**
 * The Command Center against the real store — the seam the leaf tests cannot
 * reach: rail click → store selection → the detail pane actually narrowing,
 * and a per-project mark-all-read carrying the project's path rather than
 * quietly clearing every project's inbox. Only the Tauri IPC boundary is
 * mocked.
 */

const isDirMock = vi.fn(async () => true);

vi.mock('@/lib/tauri/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/fs')>();
  return { ...actual, isDir: () => isDirMock() };
});

/**
 * The center loads schedules on mount, so a list staged straight into the
 * store would be replaced by whatever the IPC answers. Staging it here is what
 * makes the mounted component see it.
 */
const scheduleFixtures: Schedule[] = [];

vi.mock('@/lib/tauri/schedules', () => ({
  schedulesList: vi.fn(async () => scheduleFixtures),
  schedulesUpsert: vi.fn(async (schedule: unknown) => schedule),
  schedulesDelete: vi.fn(async () => undefined),
  schedulesSetEnabled: vi.fn(async () => undefined),
  schedulesPreview: vi.fn(async () => ['2026-08-20 09:00:00']),
}));

const listProjectSkillsMock = vi.fn<
  (projectPath: string, sources: unknown) => Promise<ProjectSkill[]>
>(async () => []);

vi.mock('@/lib/tauri/projectSkills', () => ({
  listProjectSkills: (projectPath: string, sources: unknown) =>
    listProjectSkillsMock(projectPath, sources),
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
  notificationsDelete: vi.fn(async () => undefined),
}));

const ALPHA = '/repo/alpha';
const BETA = '/repo/beta';
const GAMMA = '/repo/gamma';

let uid = 0;

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  uid += 1;
  return {
    id: uid,
    uid: `n-${uid}`,
    createdAt: '2026-08-12 09:00:00',
    projectPath: ALPHA,
    projectName: 'alpha',
    source: 'system',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: 'Something happened',
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

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Security-Scan',
    enabled: true,
    projectPath: ALPHA,
    projectName: 'alpha',
    specKind: 'every',
    cronExpr: null,
    everyN: 1,
    everyUnit: 'day',
    anchorAt: null,
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: '2126-08-12 12:00:00',
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

const STARRED: StarredProject[] = [
  { path: ALPHA, name: 'alpha', starredAt: 1 },
  { path: BETA, name: 'beta', starredAt: 2 },
];

function stageSchedules(...schedules: Schedule[]) {
  scheduleFixtures.splice(0, scheduleFixtures.length, ...schedules);
  useStore.setState({ schedules } as never);
}

function resetStore() {
  useStore.setState({
    notifications: [],
    notificationsUnreadCount: 0,
    notificationsStatus: 'idle',
    schedules: [],
    starredProjects: [],
    recentProjects: [],
    providers: [],
    rootPath: null,
    commandCenterOpen: true,
    commandCenterProject: undefined,
    overlayStack: { layers: [] },
    spawnDialogOpen: false,
    toasts: [],
  } as never);
}

function renderCenter() {
  return render(<CommandCenter onRunCommand={vi.fn()} onOpenProject={vi.fn(async () => {})} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  scheduleFixtures.length = 0;
  resetStore();
});

describe('CommandCenter', () => {
  it('renders nothing while it is closed', () => {
    useStore.setState({ commandCenterOpen: false } as never);
    const { container } = renderCenter();
    expect(container.firstChild).toBeNull();
  });

  it('is a labelled modal dialog', () => {
    renderCenter();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('command-center-title');
    expect(screen.getByRole('heading', { name: 'Command Center' }).id).toBe('command-center-title');
  });

  // I1: the header describes the whole inbox, whatever the rail is pointing at.
  it('summarises the whole inbox in the header', () => {
    useStore.setState({
      notifications: [
        makeNotification({ readAt: null }),
        makeNotification({ readAt: null, kind: 'ask', answeredAt: null, projectPath: BETA }),
      ],
      starredProjects: STARRED,
    } as never);
    stageSchedules(makeSchedule());

    renderCenter();

    const summary = screen.getByTestId('command-center-summary').textContent ?? '';
    expect(summary).toContain('2 unread');
    expect(summary).toContain('1 schedule');
    // The question is not in the sentence — it has its own badge (I7).
    expect(summary).not.toContain('question');
    expect(screen.getByTestId('command-center-questions-badge')).toHaveTextContent(
      '1 question waiting'
    );
  });

  it('closes on the close button', async () => {
    const user = userEvent.setup();
    renderCenter();

    await user.click(screen.getByTestId('command-center-close'));

    expect(useStore.getState().commandCenterOpen).toBe(false);
  });

  it('closes on Escape', () => {
    renderCenter();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useStore.getState().commandCenterOpen).toBe(false);
  });

  describe('the rail', () => {
    it('narrows the detail pane to the picked project', async () => {
      const user = userEvent.setup();
      useStore.setState({
        notifications: [
          makeNotification({ title: 'Alpha row' }),
          makeNotification({ title: 'Beta row', projectPath: BETA, projectName: 'beta' }),
        ],
        starredProjects: STARRED,
      } as never);

      renderCenter();
      expect(screen.getByText('Alpha row')).toBeTruthy();
      expect(screen.getByText('Beta row')).toBeTruthy();

      await user.click(screen.getByTestId(`command-center-project-${BETA}`));

      expect(useStore.getState().commandCenterProject).toBe(BETA);
      expect(screen.getByTestId('command-center-detail-heading').textContent).toContain('beta');
      expect(screen.queryByText('Alpha row')).toBeNull();
      expect(screen.getByText('Beta row')).toBeTruthy();
    });

    it('offers an idle starred project so a reminder for it is one click away', () => {
      useStore.setState({ starredProjects: STARRED } as never);

      renderCenter();

      expect(screen.getByTestId(`command-center-project-${BETA}`).dataset.quiet).toBe('true');
    });

    // The app-wide group only exists while it has rows or schedules, so a
    // Clear inside it can delete the very row that is selected — and a
    // reload can bring it back. Falling back to All keeps that from being a
    // pane with nothing in it and no way to tell why.
    it('falls back to All when the selected group stops existing', () => {
      const appRow = makeNotification({ projectPath: null, projectName: null });
      useStore.setState({
        notifications: [appRow],
        starredProjects: STARRED,
        commandCenterProject: null,
      } as never);

      const { rerender } = renderCenter();
      expect(screen.getByTestId('command-center-detail-heading').textContent).toContain('App');

      // The group's only row goes away; the selection still points at it.
      useStore.setState({ notifications: [] } as never);
      rerender(<CommandCenter onRunCommand={vi.fn()} onOpenProject={vi.fn(async () => {})} />);

      expect(screen.queryByTestId('command-center-project-__app__')).toBeNull();
      expect(screen.getByTestId('command-center-detail-heading').textContent).toContain(
        'All projects'
      );
      expect(screen.getByTestId('command-center-project-all')).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });

    it('points the rail at the project whose reminder fires next', async () => {
      const user = userEvent.setup();
      useStore.setState({ starredProjects: STARRED } as never);
      stageSchedules(makeSchedule({ projectPath: BETA, projectName: 'beta' }));

      renderCenter();
      await waitFor(() => expect(screen.getByTestId('upcoming-s1')).toBeTruthy());
      await user.click(screen.getByTestId('upcoming-s1'));

      expect(useStore.getState().commandCenterProject).toBe(BETA);
    });
  });

  describe('scoping what a button clears', () => {
    // I7 in the header: questions are the debt someone else is waiting on, so
    // they get their own pill rather than a place in the sentence.
    it('calls out open questions in their own badge', () => {
      useStore.setState({
        notifications: [makeNotification({ uid: 'q', kind: 'ask' })],
        notificationsUnreadCount: 1,
        starredProjects: STARRED,
      } as never);

      renderCenter();

      expect(screen.getByTestId('command-center-questions-badge')).toHaveTextContent(
        '1 question waiting'
      );
    });

    // Under All, the pane's own button is the whole inbox's — there is no
    // second, wider one in the header to press by mistake.
    it('marks the whole inbox read from the pane when All is selected', async () => {
      const user = userEvent.setup();
      const markAllNotificationsRead = vi.fn(async () => undefined);
      useStore.setState({
        notifications: [makeNotification()],
        notificationsUnreadCount: 1,
        starredProjects: STARRED,
        markAllNotificationsRead,
      } as never);

      renderCenter();
      expect(screen.queryByTestId('command-center-mark-all-read')).toBeNull();
      await user.click(screen.getByTestId('notifications-mark-all-read'));

      expect(markAllNotificationsRead).toHaveBeenCalled();
      expect(markAllNotificationsRead.mock.calls.at(0)?.at(0)).toBeUndefined();
    });

    // I1/I6/I12: inside a project, both buttons carry that project's path —
    // a scoped view whose buttons act globally is the worst of both.
    it('marks only the selected project read', async () => {
      const user = userEvent.setup();
      const markAllNotificationsRead = vi.fn(async () => undefined);
      useStore.setState({
        notifications: [makeNotification()],
        notificationsUnreadCount: 1,
        starredProjects: STARRED,
        commandCenterProject: ALPHA,
        markAllNotificationsRead,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId('notifications-mark-all-read'));

      expect(markAllNotificationsRead).toHaveBeenCalledWith(ALPHA);
    });

    it('clears only the selected project', async () => {
      const user = userEvent.setup();
      const clearNotifications = vi.fn(async () => undefined);
      useStore.setState({
        notifications: [makeNotification()],
        starredProjects: STARRED,
        commandCenterProject: ALPHA,
        clearNotifications,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId('notifications-clear'));

      expect(clearNotifications).toHaveBeenCalledWith(ALPHA);
    });

    it('clears everything under All', async () => {
      const user = userEvent.setup();
      const clearNotifications = vi.fn(async () => undefined);
      useStore.setState({
        notifications: [makeNotification()],
        starredProjects: STARRED,
        clearNotifications,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId('notifications-clear'));

      expect(clearNotifications).toHaveBeenCalledWith(undefined);
    });

    // The per-row dismiss button — confirm and remove one notification,
    // without a bulk Clear that also has to walk past every other row.
    it('dismisses a single row from the pane', async () => {
      const user = userEvent.setup();
      const row = makeNotification();
      const dismissNotification = vi.fn(async () => undefined);
      useStore.setState({
        notifications: [row],
        starredProjects: STARRED,
        dismissNotification,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId(`notification-dismiss-${row.uid}`));

      expect(dismissNotification).toHaveBeenCalledWith(row.uid);
    });
  });

  describe('the triggers', () => {
    it('lists a schedule with what it last raised', async () => {
      useStore.setState({
        notifications: [
          makeNotification({
            createdAt: '2026-08-12 08:00:00',
            dedupeKey: 'schedule:s1:2026-08-12 08:00:00',
          }),
        ],
        starredProjects: STARRED,
      } as never);
      stageSchedules(makeSchedule());

      renderCenter();

      expect(await screen.findByTestId('schedule-row-s1')).toBeTruthy();
      expect(screen.getByTestId('schedule-last-raised-s1').textContent).toContain('raised');
    });

    it('toggles a schedule through the store', async () => {
      const user = userEvent.setup();
      const toggleSchedule = vi.fn(async () => undefined);
      useStore.setState({ starredProjects: STARRED, toggleSchedule } as never);
      stageSchedules(makeSchedule());

      renderCenter();
      await user.click(await screen.findByTestId('schedule-toggle-s1'));

      expect(toggleSchedule).toHaveBeenCalledWith('s1', false);
    });

    it('opens the editor on a saved schedule', async () => {
      const user = userEvent.setup();
      useStore.setState({ starredProjects: STARRED } as never);
      stageSchedules(makeSchedule());

      renderCenter();
      await user.click(await screen.findByTestId('schedule-edit-s1'));

      expect(screen.getByTestId<HTMLInputElement>('schedule-name').value).toBe('Security-Scan');
    });

    // Deleting a reminder is not undoable and what you lose is future
    // prompting you will not notice is missing.
    it('asks before deleting, and a decline deletes nothing', async () => {
      const user = userEvent.setup();
      const deleteSchedule = vi.fn(async () => undefined);
      useStore.setState({ starredProjects: STARRED, deleteSchedule } as never);
      stageSchedules(makeSchedule());

      renderCenter();
      await user.click(await screen.findByTestId('schedule-delete-s1'));

      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(deleteSchedule).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('schedule-delete-s1'));
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deleteSchedule).toHaveBeenCalledWith('s1'));
    });
  });

  describe('the schedule editor', () => {
    it('opens a blank one from the header, bound to the open project', async () => {
      const user = userEvent.setup();
      useStore.setState({ rootPath: ALPHA, starredProjects: STARRED } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule'));

      expect(screen.getByTestId<HTMLInputElement>('schedule-name').value).toBe('');
      expect(screen.getByTestId<HTMLSelectElement>('schedule-project').value).toBe(ALPHA);
    });

    // The whole point of a per-project pane: creating a reminder from it must
    // not silently aim at whichever project happens to be open in the IDE.
    it('pre-binds a new schedule to the selected project, not the open one', async () => {
      const user = userEvent.setup();
      useStore.setState({
        rootPath: ALPHA,
        starredProjects: STARRED,
        commandCenterProject: BETA,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule-here'));

      expect(screen.getByTestId<HTMLSelectElement>('schedule-project').value).toBe(BETA);
    });

    // A project the app knows only from its notifications is neither pinned
    // nor recent nor open — a picker that cannot represent it would retarget
    // the new reminder to whatever it does show.
    it('offers a project it only knows from the inbox', async () => {
      const user = userEvent.setup();
      useStore.setState({
        notifications: [makeNotification({ projectPath: GAMMA, projectName: 'gamma' })],
        starredProjects: [],
        recentProjects: [],
        rootPath: null,
        commandCenterProject: GAMMA,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule-here'));

      expect(screen.getByTestId<HTMLSelectElement>('schedule-project').value).toBe(GAMMA);
    });

    it('shows the backend’s own preview of the next dates', async () => {
      const user = userEvent.setup();
      useStore.setState({ rootPath: ALPHA, starredProjects: STARRED } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule'));

      const { schedulesPreview } = await import('@/lib/tauri/schedules');
      await waitFor(() => expect(schedulesPreview).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId('schedule-preview-empty')).toBeNull());
    });

    // Re-homed from the sidebar: nothing else mounts the picker against the
    // real store, so nothing else proves that picking a project fetches THAT
    // project's skill catalogue rather than the open one's.
    it('fetches the picked project’s skills even with no project open', async () => {
      const user = userEvent.setup();
      useStore.setState({ starredProjects: STARRED, rootPath: null } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule'));

      expect(screen.getByTestId<HTMLSelectElement>('schedule-project').value).toBe('');
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-skill').disabled).toBe(true);
      expect(listProjectSkillsMock).not.toHaveBeenCalled();

      await user.selectOptions(screen.getByTestId('schedule-project'), ALPHA);

      await waitFor(() => expect(listProjectSkillsMock).toHaveBeenCalled());
      expect(listProjectSkillsMock.mock.calls.at(-1)?.[0]).toBe(ALPHA);
      expect(screen.getByTestId<HTMLInputElement>('schedule-action-skill').disabled).toBe(false);
    });

    it('saves the reminder against the project that was picked, not the open one', async () => {
      const user = userEvent.setup();
      const { schedulesUpsert } = await import('@/lib/tauri/schedules');
      useStore.setState({ starredProjects: STARRED, rootPath: null } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule'));
      await user.type(screen.getByTestId('schedule-name'), 'Weekly changelog');
      await user.selectOptions(screen.getByTestId('schedule-project'), ALPHA);
      await user.click(screen.getByTestId('schedule-save'));

      await waitFor(() => expect(schedulesUpsert).toHaveBeenCalled());
      expect(vi.mocked(schedulesUpsert).mock.calls[0][0]).toMatchObject({
        name: 'Weekly changelog',
        projectPath: ALPHA,
        projectName: 'alpha',
      });
      expect(screen.queryByTestId('schedule-name')).toBeNull();
    });

    // The editor portals above the center and pushes its own overlay layer, so
    // the first Escape belongs to it. A center that closed underneath an open
    // form would discard the form with it.
    it('gives Escape to the editor first, the center second', async () => {
      const user = userEvent.setup();
      useStore.setState({ rootPath: ALPHA, starredProjects: STARRED } as never);

      renderCenter();
      await user.click(screen.getByTestId('command-center-new-schedule'));

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('schedule-name')).toBeNull());
      expect(useStore.getState().commandCenterOpen).toBe(true);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(useStore.getState().commandCenterOpen).toBe(false);
    });
  });

  // The center covers the whole window. An action that takes you into the IDE
  // and leaves the overlay up has done its work behind a curtain.
  describe('getting out of the way', () => {
    const openTicket = {
      id: 'go',
      label: 'Open ticket',
      kind: 'open',
      target: { type: 'ticket', ticketId: 'T-1' },
    };

    it('closes on an action that navigates the IDE', async () => {
      const user = userEvent.setup();
      const setPmSelectedTicketId = vi.fn();
      const openWorkPlace = vi.fn();
      const row = makeNotification({ actions: [openTicket] });
      useStore.setState({
        notifications: [row],
        starredProjects: STARRED,
        setPmSelectedTicketId,
        openWorkPlace,
      } as never);

      renderCenter();
      await user.click(screen.getByTestId(`notification-action-${row.uid}-go`));

      await waitFor(() => expect(useStore.getState().commandCenterOpen).toBe(false));
      expect(setPmSelectedTicketId).toHaveBeenCalledWith('T-1');
      expect(openWorkPlace).toHaveBeenCalledWith('tickets');
    });

    // Answering is the one action whose result is the row itself — closing
    // would take away the rest of the inbox mid-triage.
    it('stays open when a question is answered', async () => {
      const user = userEvent.setup();
      const row = makeNotification({
        kind: 'ask',
        title: 'Deploy?',
        actions: [{ id: 'yes', label: 'Deploy it', kind: 'answer', value: 'yes' }],
      });
      useStore.setState({ notifications: [row], starredProjects: STARRED } as never);

      renderCenter();
      await user.click(screen.getByTestId(`notification-action-${row.uid}-yes`));

      await waitFor(() => expect(useStore.getState().notifications[0]?.answeredAt).not.toBeNull());
      expect(useStore.getState().commandCenterOpen).toBe(true);
    });
  });

  // I5, through the row the center reuses: an answered question shows the
  // decision, never a second chance to make it.
  it('renders a settled ask as its answer', () => {
    const settled = makeNotification({
      kind: 'ask',
      title: 'Deploy?',
      answeredAt: '2026-08-12 09:30:00',
      answer: 'yes',
      actions: [{ id: 'yes', label: 'Deploy it', kind: 'answer', value: 'yes' }],
    });
    useStore.setState({ notifications: [settled], starredProjects: STARRED } as never);

    renderCenter();

    const row = screen.getByTestId(`notification-row-${settled.uid}`);
    expect(within(row).getByText('Deploy it')).toBeTruthy();
    expect(screen.queryByTestId(`notification-action-${settled.uid}-yes`)).toBeNull();
  });
});

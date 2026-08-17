'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { defaultCommands } from '@/lib/commands/registry';
import { executeNotificationAction, NotificationActionError } from '@/lib/notifications/execute';
import { notificationTrust } from '@/lib/notifications/trust';
import {
  presentNotificationActions,
  type PresentedAction,
  type RepoDirStatus,
} from '@/lib/notifications/presentActions';
import { openSkillSpawnDialog } from '@/lib/quickAccess/launchSkill';
import { launchScheduledConductor } from '@/lib/conductor/scheduledRun';
import { buildScheduledRunDeps } from '@/lib/conductor/scheduledRunDeps';
import { isDir } from '@/lib/tauri/fs';
import {
  parseNotificationActions,
  type Notification,
  type NotificationAction,
} from '@/lib/notifications/types';
import { projectPickerOptions } from '@/lib/projects/projectOptions';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import { listProjectSkills, type ProjectSkill } from '@/lib/tauri/projectSkills';
import { schedulesPreview, type Schedule } from '@/lib/tauri/schedules';
import { NotificationsPanel } from './NotificationsPanel';
import { ScheduleEditor } from './ScheduleEditor';
import { SchedulesSection } from './SchedulesSection';

export interface NotificationsSidebarProps {
  /** Runs a command from the manifest — the same dispatch the palette uses. */
  onRunCommand: (commandId: string) => void;
  /** Opens (or switches to) a project — `handleOpenRecent`, for a `run-conductor` click. */
  onOpenProject: (path: string) => Promise<void>;
}

const KNOWN_COMMAND_IDS = new Set(defaultCommands.map((command) => command.id));

const isKnownCommandId = (id: string) => KNOWN_COMMAND_IDS.has(id);

function repoPathsFromNotifications(notifications: Notification[]): string[] {
  const paths = new Set<string>();
  for (const notification of notifications) {
    for (const action of parseNotificationActions(notification.actions, isKnownCommandId)) {
      if (
        (action.kind === 'run-skill' ||
          action.kind === 'run-combo' ||
          action.kind === 'run-conductor' ||
          action.kind === 'spawn-agent') &&
        action.repoPath
      ) {
        paths.add(action.repoPath);
      }
    }
  }
  return [...paths];
}

/**
 * Connects the inbox panel to the store.
 *
 * The panel itself stays prop-driven and testable; this is the only piece that
 * knows about the store, and it owns the 1-second clock. That clock is why the
 * connector is a leaf: hosting `useNow` further up would re-render the whole
 * IDE every second (the same reason `AttentionTitle` is its own null-rendering
 * leaf in page.tsx).
 */
export function NotificationsSidebar({ onRunCommand, onOpenProject }: NotificationsSidebarProps) {
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();

  /** Which schedule the editor is open for; `{ schedule: null }` means new. */
  const [editing, setEditing] = useState<{ schedule: Schedule | null } | null>(null);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [discoveredByPath, setDiscoveredByPath] = useState<{
    path: string;
    skills: ProjectSkill[];
  } | null>(null);

  const rootPath = useStore((s) => s.rootPath);
  const schedules = useStore((s) => s.schedules);
  const loadSchedules = useStore((s) => s.loadSchedules);
  const saveSchedule = useStore((s) => s.saveSchedule);
  const deleteSchedule = useStore((s) => s.deleteSchedule);
  const toggleSchedule = useStore((s) => s.toggleSchedule);

  // The list is app-global, so it loads with the panel rather than with a
  // project.
  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.notificationsUnreadCount);
  const status = useStore((s) => s.notificationsStatus);
  const projectFilter = useStore((s) => s.notificationsProjectFilter);

  const markNotificationRead = useStore((s) => s.markNotificationRead);
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead);
  const clearNotifications = useStore((s) => s.clearNotifications);
  const setNotificationsProjectFilter = useStore((s) => s.setNotificationsProjectFilter);
  const starredProjects = useStore((s) => s.starredProjects);
  const recentProjects = useStore((s) => s.recentProjects);
  const providers = useStore((s) => s.providers);

  const [repoDirStatus, setRepoDirStatus] = useState<Map<string, RepoDirStatus>>(new Map());
  const probedPaths = useRef(new Set<string>());

  const writeRepoDir = useCallback((path: string, ok: boolean) => {
    setRepoDirStatus((prev) => {
      const next = new Map(prev);
      next.set(path, ok ? 'dir' : 'missing');
      return next;
    });
  }, []);

  const parseActions = useCallback(
    (notification: Notification): PresentedAction[] =>
      presentNotificationActions(
        parseNotificationActions(notification.actions, isKnownCommandId),
        starredProjects,
        repoDirStatus,
        rootPath
      ),
    [starredProjects, repoDirStatus, rootPath]
  );

  // Probe each new repoPath once. Absent / in-flight reads as unknown (button
  // stays enabled). 'dir' stays trusted until click-time execute; 'missing' is
  // re-checked on window focus so a restored folder can re-enable.
  useEffect(() => {
    for (const path of repoPathsFromNotifications(notifications)) {
      if (probedPaths.current.has(path)) continue;
      probedPaths.current.add(path);
      void isDir(path)
        .then((ok) => writeRepoDir(path, ok))
        .catch(() => {
          // Stay 'unknown': click-time execute still gates a vanished folder.
        });
    }
  }, [notifications, writeRepoDir]);

  useEffect(() => {
    const onFocus = () => {
      for (const [path, status] of repoDirStatus) {
        if (status !== 'missing') continue;
        void isDir(path)
          .then((ok) => writeRepoDir(path, ok))
          .catch(() => {
            // Keep the last known 'missing'; the next focus can try again.
          });
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [repoDirStatus, writeRepoDir]);

  const handleAction = useCallback(
    async (notification: Notification, action: NotificationAction) => {
      const store = useStore.getState();

      // Every action on a question settles it, not just an `answer` one — and
      // it is stamped before the effect runs, so a spawn that fails still
      // leaves the decision recorded rather than re-asking.
      if (notification.kind === 'ask') {
        await store.answerNotification(notification.uid, action.id);
      } else {
        await store.markNotificationRead(notification.uid);
      }

      try {
        await executeNotificationAction(
          action,
          {
            // Selected on the way out, so the agent this click started is the
            // one the terminal is showing. A launch you cannot see is the same
            // problem as a launch that never happened.
            spawnAgent: async (config) => {
              const agent = await store.spawnNewAgent(config);
              store.selectAgent(agent.id);
              store.showToast(`${agent.name} started`, 'success');
              return agent;
            },
            openSpawnDialog: ({ task, repoPath, preset }) =>
              openSkillSpawnDialog(store, repoPath, {
                prompt: task,
                providerId: preset?.providerId,
                model: preset?.model,
                permissionMode: preset?.permissionMode,
              }),
            startSkillCombo: (projectPath, combo) => store.startSkillCombo(projectPath, combo),
            projectDirExists: (path) => isDir(path),
            openFile: (path) => {
              const name = path.split('/').pop() ?? path;
              store.openTab({ id: path, path, name });
              store.setActiveTab(path);
            },
            openTicket: (ticketId) => {
              const ticket = useStore.getState().pmDraftTickets.find((t) => t.id === ticketId);
              if (ticket) store.setPmSelectedEpicId(ticket.epicId);
              store.setPmSelectedTicketId(ticketId);
              store.openWorkPlace('tickets');
            },
            openGoal: (goalId) => {
              store.setSelectedGoalId(goalId);
              store.openWorkPlace('goals');
            },
            openAgent: (agentId) => store.selectAgent(agentId),
            runCommand: onRunCommand,
            // A run against a different project opens it first — closing every
            // tab — so this asks before doing that, the same in-app `confirm`
            // the agent panel uses for an equivalent switch.
            startConductorRun: async (input) => {
              const openPath = useStore.getState().rootPath;
              if (openPath !== null && openPath !== input.repoPath) {
                const folder = input.repoPath.split('/').filter(Boolean).pop() ?? input.repoPath;
                const go = await confirm({
                  title: 'Switch project?',
                  message: `Starting this run opens "${folder}" and closes the tabs of the current project.`,
                  confirmLabel: 'Open & start',
                });
                if (!go) return;
              }
              await launchScheduledConductor(input, buildScheduledRunDeps(onOpenProject));
            },
          },
          {
            fallbackCwd: useStore.getState().rootPath ?? undefined,
            // What the payload may decide about the launch depends on who
            // wrote it, never on what it says about itself.
            trust: notificationTrust(notification.source),
            providers: useStore.getState().providers,
            origin: notification.origin ?? undefined,
          }
        );
      } catch (error) {
        // The decision stands; only the effect failed. Say so rather than
        // leaving the click looking like it did nothing.
        const message =
          error instanceof NotificationActionError && error.code === 'missing-project'
            ? 'Project folder not found'
            : error instanceof NotificationActionError && error.code === 'empty-combo'
              ? 'Combo has no valid steps'
              : `"${action.label}" could not run`;
        store.showToast(message, 'error');
      }
    },
    [onRunCommand, onOpenProject, confirm]
  );

  const handleOpen = useCallback(
    (uid: string) => void markNotificationRead(uid),
    [markNotificationRead]
  );

  const handlers = useMemo(
    () => ({
      onMarkAllRead: () => void markAllNotificationsRead(),
      onClear: () => void clearNotifications(),
    }),
    [markAllNotificationsRead, clearNotifications]
  );

  // Deleting a reminder is not undoable and the thing you lose is future
  // prompting you will not notice is missing — so it asks.
  const confirmDelete = useCallback(
    async (schedule: Schedule) => {
      const go = await confirm({
        title: 'Delete this schedule?',
        message: `"${schedule.name}" will no longer remind you. Notifications already sent stay.`,
        confirmLabel: 'Delete',
      });
      if (go) await deleteSchedule(schedule.id);
    },
    [confirm, deleteSchedule]
  );

  // The preview is computed by the backend, from the same code the runner uses,
  // so the form can never promise a date the runner would not pick.
  useEffect(() => {
    if (draft === null) return;
    let current = true;
    schedulesPreview(draft, 3)
      .then((next) => {
        if (current) setPreview(next);
      })
      .catch(() => {
        if (current) setPreview([]);
      });
    return () => {
      current = false;
    };
  }, [draft]);

  // Derived rather than cleared in the effect: with no draft there is nothing
  // to preview, and holding the last one would flash a stale date into the
  // next editor that opens.
  const visiblePreview = draft === null ? [] : preview;

  const editorProjectPath =
    editing === null
      ? null
      : (draft?.projectPath ?? editing.schedule?.projectPath ?? rootPath ?? null);

  useEffect(() => {
    if (editorProjectPath === null) return;
    const path = editorProjectPath;
    let cancelled = false;
    void listProjectSkills(path, enabledSkillSources(loadSkillSources())).then((found) => {
      if (!cancelled) setDiscoveredByPath({ path, skills: found });
    });
    return () => {
      cancelled = true;
    };
  }, [editorProjectPath]);

  // Only the catalogue for this path — a previous project's list must not sit
  // in the picker while the next fetch is in flight.
  const skillsForEditor =
    editorProjectPath !== null && discoveredByPath?.path === editorProjectPath
      ? discoveredByPath.skills
      : [];

  // Built from the schedule being edited, not from the draft: the picker has to
  // keep offering the project the schedule was SAVED with, even after the draft
  // has been pointed somewhere else.
  const boundProject = editing?.schedule?.projectPath ?? null;
  const projectOptions = useMemo(
    () =>
      projectPickerOptions({
        starred: starredProjects,
        recent: recentProjects,
        openPath: rootPath,
        bound:
          boundProject === null
            ? null
            : { path: boundProject, name: editing?.schedule?.projectName ?? null },
      }),
    [starredProjects, recentProjects, rootPath, boundProject, editing]
  );

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <SchedulesSection
        schedules={schedules}
        now={now}
        starredProjects={starredProjects}
        onCreate={() => setEditing({ schedule: null })}
        onEdit={(schedule) => setEditing({ schedule })}
        onToggle={(schedule, enabled) => void toggleSchedule(schedule.id, enabled)}
        onDelete={(schedule) => void confirmDelete(schedule)}
      />

      <div className="min-h-0 flex-1">
        <NotificationsPanel
          notifications={notifications}
          unreadCount={unreadCount}
          status={status}
          projectFilter={projectFilter}
          now={now}
          starredProjects={starredProjects}
          parseActions={parseActions}
          onOpen={handleOpen}
          onAction={(notification, action) => void handleAction(notification, action)}
          onSetProjectFilter={setNotificationsProjectFilter}
          onMarkAllRead={handlers.onMarkAllRead}
          onClear={handlers.onClear}
        />
      </div>

      {editing !== null && (
        <ScheduleEditor
          schedule={editing.schedule}
          defaultProjectPath={rootPath}
          defaultProjectName={rootPath?.split('/').filter(Boolean).pop() ?? null}
          preview={visiblePreview}
          starredProjects={starredProjects}
          projectOptions={projectOptions}
          discoveredSkills={skillsForEditor}
          providers={providers}
          onDraftChange={setDraft}
          onSave={(next) => {
            void saveSchedule(next);
            setEditing(null);
            setDraft(null);
          }}
          onCancel={() => {
            setEditing(null);
            setDraft(null);
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

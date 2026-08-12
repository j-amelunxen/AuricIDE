'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { defaultCommands } from '@/lib/commands/registry';
import { executeNotificationAction } from '@/lib/notifications/execute';
import {
  parseNotificationActions,
  type Notification,
  type NotificationAction,
} from '@/lib/notifications/types';
import { schedulesPreview, type Schedule } from '@/lib/tauri/schedules';
import { NotificationsPanel } from './NotificationsPanel';
import { ScheduleEditor } from './ScheduleEditor';
import { SchedulesSection } from './SchedulesSection';

export interface NotificationsSidebarProps {
  /** Runs a command from the manifest — the same dispatch the palette uses. */
  onRunCommand: (commandId: string) => void;
}

const KNOWN_COMMAND_IDS = new Set(defaultCommands.map((command) => command.id));

/**
 * Connects the inbox panel to the store.
 *
 * The panel itself stays prop-driven and testable; this is the only piece that
 * knows about the store, and it owns the 1-second clock. That clock is why the
 * connector is a leaf: hosting `useNow` further up would re-render the whole
 * IDE every second (the same reason `AttentionTitle` is its own null-rendering
 * leaf in page.tsx).
 */
export function NotificationsSidebar({ onRunCommand }: NotificationsSidebarProps) {
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();

  /** Which schedule the editor is open for; `{ schedule: null }` means new. */
  const [editing, setEditing] = useState<{ schedule: Schedule | null } | null>(null);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [preview, setPreview] = useState<string[]>([]);

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

  const parseActions = useCallback(
    (notification: Notification) =>
      parseNotificationActions(notification.actions, (id) => KNOWN_COMMAND_IDS.has(id)),
    []
  );

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
            spawnAgent: (config) => store.spawnNewAgent(config),
            openFile: (path) => {
              const name = path.split('/').pop() ?? path;
              store.openTab({ id: path, path, name });
              store.setActiveTab(path);
            },
            openTicket: (ticketId) => {
              const ticket = useStore.getState().pmDraftTickets.find((t) => t.id === ticketId);
              if (ticket) store.setPmSelectedEpicId(ticket.epicId);
              store.setPmSelectedTicketId(ticketId);
              store.setPmModalOpen(true);
            },
            openGoal: (goalId) => {
              store.setSelectedGoalId(goalId);
              store.setGoalsModalOpen(true);
            },
            openAgent: (agentId) => store.selectAgent(agentId),
            runCommand: onRunCommand,
          },
          useStore.getState().rootPath ?? undefined
        );
      } catch {
        // The decision stands; only the effect failed. Say so rather than
        // leaving the click looking like it did nothing.
        store.showToast(`"${action.label}" konnte nicht ausgeführt werden`, 'error');
      }
    },
    [onRunCommand]
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
        title: 'Zeitplan löschen?',
        message: `"${schedule.name}" wird nicht mehr erinnern. Bereits verschickte Meldungen bleiben.`,
        confirmLabel: 'Löschen',
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

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <SchedulesSection
        schedules={schedules}
        now={now}
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

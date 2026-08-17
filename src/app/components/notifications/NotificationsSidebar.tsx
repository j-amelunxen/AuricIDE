'use client';

import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { nextDueSchedule, selectTray } from '@/lib/notifications/tray';
import { NotificationTray } from './NotificationTray';
import { useNotificationActions } from './useNotificationActions';

export interface NotificationsSidebarProps {
  /** Runs a command from the manifest — the same dispatch the palette uses. */
  onRunCommand: (commandId: string) => void;
  /** Opens (or switches to) a project — `handleOpenRecent`, for a `run-conductor` click. */
  onOpenProject: (path: string) => Promise<void>;
}

/**
 * Connects the tray to the store.
 *
 * The tray itself stays prop-driven and testable; this is the only piece that
 * knows about the store, and it owns the 1-second clock. That clock is why the
 * connector is a leaf: hosting `useNow` further up would re-render the whole
 * IDE every second (the same reason `AttentionTitle` is its own null-rendering
 * leaf in page.tsx).
 *
 * Everything longer than a glance lives in the Command Center, which this only
 * opens — the sidebar is deliberately not a second place where the inbox can be
 * managed.
 */
export function NotificationsSidebar({ onRunCommand, onOpenProject }: NotificationsSidebarProps) {
  const now = useNow();

  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.notificationsUnreadCount);
  const status = useStore((s) => s.notificationsStatus);
  const starredProjects = useStore((s) => s.starredProjects);
  const schedules = useStore((s) => s.schedules);
  const loadSchedules = useStore((s) => s.loadSchedules);
  const openCommandCenter = useStore((s) => s.openCommandCenter);

  // The schedules are app-global, and the tray states the next one out loud —
  // so they load with the panel rather than with a project. Without this the
  // line would read "No schedules" until something else happened to fetch them.
  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  // Derived here, never in the selector: `selectTray` builds fresh arrays every
  // call, and a zustand v5 selector that returns a new reference re-renders
  // forever.
  const tray = useMemo(() => selectTray(notifications), [notifications]);
  const nextDue = useMemo(() => nextDueSchedule(schedules, now), [schedules, now]);

  const { parseActions, handleAction, handleOpen, confirmDialog } = useNotificationActions({
    notifications,
    onRunCommand,
    onOpenProject,
  });

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <NotificationTray
        pinned={tray.pinned}
        latest={tray.latest}
        hidden={tray.hidden}
        hiddenUnread={tray.hiddenUnread}
        unreadCount={unreadCount}
        status={status}
        nextDue={nextDue}
        scheduleCount={schedules.length}
        now={now}
        starredProjects={starredProjects}
        parseActions={parseActions}
        onOpen={handleOpen}
        onAction={(notification, action) => void handleAction(notification, action)}
        onOpenCenter={() => openCommandCenter()}
      />
      {confirmDialog}
    </div>
  );
}

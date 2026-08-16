'use client';

import { useMemo, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { formatNotificationProject } from '@/lib/notifications/format';
import type { PresentedAction } from '@/lib/notifications/presentActions';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { NotificationRow } from './NotificationRow';

export interface NotificationsPanelProps {
  notifications: Notification[];
  /** Unread across the whole inbox, independent of the filters below. */
  unreadCount: number;
  status: 'idle' | 'loading' | 'error';
  projectFilter: string | null;
  now: number;
  /** Only for the marks pinned projects carry; rows come from every project. */
  starredProjects: StarredProject[];
  parseActions: (notification: Notification) => PresentedAction[];
  onOpen: (uid: string) => void;
  onAction: (notification: Notification, action: NotificationAction) => void;
  onSetProjectFilter: (projectPath: string | null) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}

type ReadFilter = 'all' | 'unread';

interface ProjectOption {
  path: string | null;
  label: string;
}

/** Every project represented in the inbox, in first-seen order. */
function projectOptions(notifications: Notification[]): ProjectOption[] {
  const seen = new Map<string | null, string>();
  for (const notification of notifications) {
    if (seen.has(notification.projectPath)) continue;
    seen.set(
      notification.projectPath,
      formatNotificationProject(notification.projectName, notification.projectPath)
    );
  }
  return [...seen].map(([path, label]) => ({ path, label }));
}

/**
 * The inbox: everything that happened, across every project.
 *
 * Prop-driven on purpose, like `ConductorPanel` — the panel renders what it is
 * handed and reports clicks, so it can be tested without a store.
 *
 * The one rule that shapes this component: **the header count describes the
 * whole inbox, never the filtered view.** Filters hide rows; a count that
 * shrank with them would teach you to distrust it, and the point of a badge is
 * that you can act on it without opening anything.
 */
export function NotificationsPanel({
  notifications,
  unreadCount,
  status,
  projectFilter,
  now,
  starredProjects,
  parseActions,
  onOpen,
  onAction,
  onSetProjectFilter,
  onMarkAllRead,
  onClear,
}: NotificationsPanelProps) {
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');

  const projects = useMemo(() => projectOptions(notifications), [notifications]);

  const visible = useMemo(
    () =>
      notifications.filter((n) => {
        if (projectFilter !== null && n.projectPath !== projectFilter) return false;
        if (readFilter === 'unread' && n.readAt !== null) return false;
        return true;
      }),
    [notifications, projectFilter, readFilter]
  );

  const filtered = projectFilter !== null || readFilter === 'unread';

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/2 p-3">
        <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
          Notifications
          {unreadCount > 0 && (
            <span
              data-testid="notifications-unread-count"
              className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[9px] tracking-normal text-primary-light"
            >
              {unreadCount}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          <button
            data-testid="notifications-mark-all-read"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            aria-label="Mark all as read"
            title="Mark all as read"
            className="rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30"
          >
            <AuricIcon name="visibility" className="text-sm" />
          </button>
          <button
            data-testid="notifications-clear"
            onClick={onClear}
            title="Clear done items. Open questions stay."
            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <AuricIcon name="delete_sweep" className="mr-1 text-sm" />
            Clear
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-2 py-1.5">
        <FilterChip
          testId="notifications-filter-all"
          active={readFilter === 'all'}
          onClick={() => setReadFilter('all')}
        >
          All
        </FilterChip>
        <FilterChip
          testId="notifications-filter-unread"
          active={readFilter === 'unread'}
          onClick={() => setReadFilter('unread')}
        >
          Unread
        </FilterChip>

        {projects.length > 1 && (
          <>
            <span aria-hidden="true" className="mx-0.5 h-3 w-px bg-white/10" />
            <FilterChip
              testId="notifications-project-all"
              active={projectFilter === null}
              onClick={() => onSetProjectFilter(null)}
            >
              All projects
            </FilterChip>
            {projects.map((project) => (
              <FilterChip
                key={project.path ?? '__app__'}
                testId={`notifications-project-${project.label}`}
                active={projectFilter === project.path}
                onClick={() => onSetProjectFilter(project.path)}
              >
                {project.label}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {status === 'error' && (
          <p data-testid="notifications-error" className="px-1 py-2 text-[11px] text-[#ff4a4a]/80">
            Inbox could not be read. It will retry when you come back to this window.
          </p>
        )}

        {visible.length === 0 ? (
          <p
            data-testid="notifications-empty"
            className="px-1 py-3 text-[11px] text-foreground-muted"
          >
            {notifications.length === 0
              ? 'Inbox empty. Agents, schedules, and the Conductor report here.'
              : 'Nothing in this selection.'}
          </p>
        ) : (
          visible.map((notification) => (
            <NotificationRow
              key={notification.uid}
              notification={notification}
              actions={parseActions(notification)}
              now={now}
              starredProjects={starredProjects}
              onOpen={onOpen}
              onAction={onAction}
            />
          ))
        )}

        {/* Says out loud that rows are hidden, so a short list is never mistaken
            for an empty inbox. */}
        {filtered && notifications.length > visible.length && (
          <p
            data-testid="notifications-hidden-note"
            className="px-1 pt-1 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/50"
          >
            {notifications.length - visible.length} hidden by filters
          </p>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`max-w-[110px] truncate rounded-lg px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? 'bg-primary/20 font-semibold text-primary-light'
          : 'text-foreground-muted hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

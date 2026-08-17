'use client';

import { useMemo, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { PresentedAction } from '@/lib/notifications/presentActions';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { InboxErrorNote, InboxHeading } from './InboxChrome';
import { NotificationRow } from './NotificationRow';

export interface NotificationsPanelProps {
  notifications: Notification[];
  /** Unread across the whole inbox, independent of the filter below. */
  unreadCount: number;
  status: 'idle' | 'loading' | 'error';
  now: number;
  /** Only for the marks pinned projects carry; rows come from every project. */
  starredProjects: StarredProject[];
  parseActions: (notification: Notification) => PresentedAction[];
  onOpen: (uid: string) => void;
  onAction: (notification: Notification, action: NotificationAction) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}

type ReadFilter = 'all' | 'unread';

/**
 * The inbox: everything that happened, across every project.
 *
 * Prop-driven on purpose, like `ConductorPanel` — the panel renders what it is
 * handed and reports clicks, so it can be tested without a store.
 *
 * The one rule that shapes this component: **the header count describes the
 * whole inbox, never the filtered view.** The filter hides rows; a count that
 * shrank with it would teach you to distrust it, and the point of a badge is
 * that you can act on it without opening anything.
 *
 * Which project the rows come from is decided by whoever mounts the panel —
 * the Command Center's rail — never in here. Two controls for one choice, one
 * of them out of sight, is how a list ends up narrowed for a reason nobody
 * can see.
 */
export function NotificationsPanel({
  notifications,
  unreadCount,
  status,
  now,
  starredProjects,
  parseActions,
  onOpen,
  onAction,
  onMarkAllRead,
  onClear,
}: NotificationsPanelProps) {
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');

  const visible = useMemo(
    () =>
      readFilter === 'unread' ? notifications.filter((n) => n.readAt === null) : notifications,
    [notifications, readFilter]
  );

  const filtered = readFilter === 'unread';

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/2 p-3">
        <InboxHeading unreadCount={unreadCount} />
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
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {status === 'error' && <InboxErrorNote />}

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

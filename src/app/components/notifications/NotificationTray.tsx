'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { formatNextDue } from '@/lib/notifications/scheduleFormat';
import type { PresentedAction } from '@/lib/notifications/presentActions';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule } from '@/lib/tauri/schedules';
import { InboxErrorNote, InboxHeading } from './InboxChrome';
import { NotificationRow } from './NotificationRow';

export interface NotificationTrayProps {
  /** Unanswered questions. Uncapped and always on top — debts do not rotate out. */
  pinned: Notification[];
  /** The newest few of everything else, newest first. */
  latest: Notification[];
  /** Rows the tray is not showing, and how many of those are unread. */
  hidden: number;
  hiddenUnread: number;
  /** Unread across the whole inbox, independent of what is on screen. */
  unreadCount: number;
  status: 'idle' | 'loading' | 'error';
  /** The next reminder that will fire anywhere, or null when none will. */
  nextDue: Schedule | null;
  scheduleCount: number;
  now: number;
  /** Only for the marks pinned projects carry; rows come from every project. */
  starredProjects: StarredProject[];
  parseActions: (notification: Notification) => PresentedAction[];
  onOpen: (uid: string) => void;
  onAction: (notification: Notification, action: NotificationAction) => void;
  onOpenCenter: () => void;
}

/**
 * The sidebar's inbox: the few rows worth a glance, and the way to everything
 * else.
 *
 * It is a **peek, not a list**. Three things follow from that and shape every
 * decision here: the counts describe the whole inbox rather than the rows on
 * screen, the truncation says so out loud, and an unanswered question is never
 * one of the things that scrolls away. A short panel that reads as a quiet
 * inbox is the failure mode this component exists to prevent.
 *
 * Prop-driven like `NotificationsPanel` — the selection is `selectTray`'s job,
 * the store is the connector's, and this renders what it is handed.
 */
export function NotificationTray({
  pinned,
  latest,
  hidden,
  hiddenUnread,
  unreadCount,
  status,
  nextDue,
  scheduleCount,
  now,
  starredProjects,
  parseActions,
  onOpen,
  onAction,
  onOpenCenter,
}: NotificationTrayProps) {
  const rows = [...pinned, ...latest];
  const arrived = useArrivals(rows.map((notification) => notification.uid));

  const row = (notification: Notification) => (
    <div
      key={notification.uid}
      className={arrived.has(notification.uid) ? 'notification-row-enter' : undefined}
    >
      <NotificationRow
        notification={notification}
        actions={parseActions(notification)}
        now={now}
        starredProjects={starredProjects}
        onOpen={onOpen}
        onAction={onAction}
      />
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-white/2 p-3">
        <InboxHeading unreadCount={unreadCount} testId="tray-unread-count" />
        {/* Icon-only up here — the sidebar is too narrow for a label beside
            the heading, and the footer below carries the words. */}
        <button
          data-testid="notifications-open-center"
          onClick={onOpenCenter}
          aria-haspopup="dialog"
          aria-label="Command Center"
          title="Command Center — questions, schedules, every project"
          className="press-feedback flex-shrink-0 rounded-lg p-1 text-primary-light hover:bg-primary/15"
        >
          <AuricIcon name="hub" className="text-sm" />
        </button>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {status === 'error' && <InboxErrorNote />}

        {rows.length === 0 && (
          <p data-testid="tray-empty" className="px-1 py-3 text-[11px] text-foreground-muted">
            Inbox empty. Agents, schedules, and the Conductor report here.
          </p>
        )}

        {/* Named, because the two blocks mean different things: one is owed an
            answer, the other is history. Unlabelled they read as one list
            sorted by nothing the user can see. */}
        {pinned.length > 0 && (
          <p
            data-testid="tray-pinned-label"
            className="px-1 pt-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#ffce2e]/80"
          >
            Needs an answer
          </p>
        )}
        {pinned.map(row)}

        {/* Only as the other side of a divide — over a lone block it would be
            labelling the whole tray, which the header already did. */}
        {pinned.length > 0 && latest.length > 0 && (
          <p
            data-testid="tray-latest-label"
            className="border-t border-white/5 px-1 pt-2 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-muted/50"
          >
            Latest
          </p>
        )}
        {latest.map(row)}

        {/* The tray is a peek. Saying how much it is not showing is what keeps
            a short list from reading as an empty inbox. */}
        {hidden > 0 && (
          <button
            data-testid="notifications-more"
            onClick={onOpenCenter}
            className="press-feedback w-full rounded-lg px-1 py-1.5 text-left font-mono text-[9px] uppercase tracking-wider text-foreground-muted/60 hover:bg-white/5 hover:text-foreground-muted"
          >
            {hidden} more
            {hiddenUnread > 0 && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="text-primary-light">{hiddenUnread} unread</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* The management door, spelled out. One button, two lines: what it
          opens, and the next thing the scheduler will do — so the tray still
          answers "when does something fire" without listing every reminder. */}
      <button
        data-testid="notifications-next-schedule"
        onClick={onOpenCenter}
        aria-haspopup="dialog"
        title="Manage schedules and every project's notifications"
        className="press-feedback group flex flex-col gap-0.5 border-t border-white/5 px-3 py-2 text-left hover:bg-primary/5"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-light">
          <AuricIcon name="hub" className="flex-shrink-0 text-sm" />
          Command Center
          <AuricIcon
            name="chevron_right"
            className="ml-auto flex-shrink-0 text-sm opacity-50 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/60">
          <AuricIcon name="schedule" className="flex-shrink-0 text-[11px]" />
          {nextDue !== null && (
            <>
              <span className="min-w-0 truncate">Next: {nextDue.name}</span>
              <span aria-hidden="true">·</span>
              <span className="flex-shrink-0">{formatNextDue(nextDue, now)}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="flex-shrink-0">
            {scheduleCount === 0
              ? 'No schedules'
              : `${scheduleCount} ${scheduleCount === 1 ? 'schedule' : 'schedules'}`}
          </span>
          {/* Reminders that exist but will never fire are worth saying: "no
              schedules" would be a lie about a list the user can see in the
              center, and the reason is usually that they are all switched off. */}
          {nextDue === null && scheduleCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="flex-shrink-0">none due</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * Which rows appeared since the last render.
 *
 * The first paint is deliberately not an arrival: opening the panel would
 * otherwise animate the whole list, which says "all of this just happened"
 * about rows that are days old.
 *
 * Kept in state rather than a ref because the answer is rendered — it decides
 * a class name — and adjusting state from the incoming list is the sanctioned
 * way to derive "what changed since last time" during render.
 */
function useArrivals(uids: string[]): Set<string> {
  const key = uids.join('\n');
  const [seen, setSeen] = useState(() => ({
    key,
    uids: new Set(uids),
    arrived: new Set<string>(),
  }));

  if (seen.key !== key) {
    setSeen((prev) => ({
      key,
      uids: new Set(uids),
      arrived: new Set(uids.filter((uid) => !prev.uids.has(uid))),
    }));
    // This render is thrown away — React re-runs the component with the state
    // just set — so nothing here is animated on the strength of it.
    return new Set<string>();
  }

  return seen.arrived;
}

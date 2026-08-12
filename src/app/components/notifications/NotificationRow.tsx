'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  formatNotificationAge,
  formatNotificationProject,
  severityTone,
} from '@/lib/notifications/format';
import type { Notification, NotificationAction } from '@/lib/notifications/types';

export interface NotificationRowProps {
  notification: Notification;
  actions: NotificationAction[];
  now: number;
  onOpen: (uid: string) => void;
  onAction: (notification: Notification, action: NotificationAction) => void;
}

/**
 * One entry in the inbox.
 *
 * Two markers, two jobs, never mixed up: severity owns the left edge and the
 * icon, unread owns the dot next to the title. A read error still looks like an
 * error, and an unread info still announces itself.
 */
export function NotificationRow({
  notification,
  actions,
  now,
  onOpen,
  onAction,
}: NotificationRowProps) {
  const tone = severityTone(notification.severity);
  const unread = notification.readAt === null;
  const settled = notification.kind === 'ask' && notification.answeredAt !== null;
  const chosen = settled
    ? (actions.find((a) => a.id === notification.answer)?.label ?? notification.answer)
    : null;

  return (
    <div
      data-testid={`notification-row-${notification.uid}`}
      data-unread={unread}
      className={`relative overflow-hidden rounded-xl border border-white/5 pl-3 transition-colors ${
        unread ? 'bg-white/[0.06]' : 'bg-white/[0.02]'
      }`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${tone.edge}`} />

      <button
        onClick={() => onOpen(notification.uid)}
        className="flex w-full items-start gap-2 p-2.5 text-left"
      >
        <AuricIcon name={tone.icon} className={`mt-[1px] flex-shrink-0 text-sm ${tone.color}`} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {unread && (
              <span
                data-testid="notification-unread-dot"
                aria-label="ungelesen"
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
              />
            )}
            <span
              className={`truncate text-[11px] ${unread ? 'font-semibold text-foreground' : 'text-foreground-muted'}`}
            >
              {notification.title}
            </span>
          </span>

          {notification.body !== null && notification.body !== '' && (
            <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-foreground-muted/80">
              {notification.body}
            </span>
          )}

          <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/50">
            <span className="truncate">
              {formatNotificationProject(notification.projectName, notification.projectPath)}
            </span>
            {notification.origin !== null && notification.origin !== '' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{notification.origin}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{formatNotificationAge(notification.createdAt, now)}</span>
          </span>
        </span>
      </button>

      {/* A settled question shows what was chosen instead of the buttons: it
          must not be answerable twice, and the record of the decision is the
          point of having asked. */}
      {settled ? (
        <p
          data-testid={`notification-answered-${notification.uid}`}
          className="flex items-center gap-1 px-2.5 pb-2.5 pl-[26px] font-mono text-[9px] uppercase tracking-wider text-foreground-muted/60"
        >
          <AuricIcon name="check" className="text-[11px]" />
          {chosen}
        </p>
      ) : (
        actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2.5 pb-2.5 pl-[26px]">
            {actions.map((action) => (
              <button
                key={action.id}
                data-testid={`notification-action-${notification.uid}-${action.id}`}
                onClick={() => onAction(notification, action)}
                className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-white/10"
              >
                {action.label}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

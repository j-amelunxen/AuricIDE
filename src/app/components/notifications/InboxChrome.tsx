'use client';

/**
 * The two pieces of chrome the tray and the full panel share verbatim: the
 * heading with its unread pill, and the read-error note. One definition, so
 * the badge in the sidebar and the badge over a project's rows can never
 * disagree on what a count looks like.
 */

export function InboxHeading({
  unreadCount,
  // The tray and the full panel are on screen together once the center is
  // open, so the badge each of them owns has to be findable on its own.
  testId = 'notifications-unread-count',
}: {
  unreadCount: number;
  testId?: string;
}) {
  return (
    <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
      Notifications
      {unreadCount > 0 && (
        <span
          data-testid={testId}
          className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[9px] tracking-normal text-primary-light"
        >
          {unreadCount}
        </span>
      )}
    </h2>
  );
}

export function InboxErrorNote() {
  return (
    <p data-testid="notifications-error" className="px-1 py-2 text-[11px] text-[#ff4a4a]/80">
      Inbox could not be read. It will retry when you come back to this window.
    </p>
  );
}

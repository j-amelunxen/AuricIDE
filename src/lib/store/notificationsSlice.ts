import type { StateCreator } from 'zustand';
import type { Notification } from '@/lib/notifications/types';
import { deservesOsBanner, notifyOs, osBannerForBatch } from '@/lib/notifications/os';
import {
  notificationsAnswer,
  notificationsClear,
  notificationsDelete,
  notificationsDispatch,
  notificationsList,
  notificationsMarkAllRead,
  notificationsMarkRead,
  type NotificationInput,
} from '@/lib/tauri/notifications';

/**
 * The inbox, as the UI sees it.
 *
 * Two rules hold throughout and are worth stating before the code:
 *
 * - **The unread count describes the whole inbox, never the filtered view.**
 *   A project filter hides rows; it must not change what the badge claims.
 *   A count that shrinks when you narrow a filter teaches you to distrust it.
 * - **This is not the attention model.** `countNeedingAttention` answers "who
 *   needs me right now" and heals itself. This answers "what happened", and
 *   only reading or answering clears it. The two numbers are never summed.
 */

/**
 * Which rows a bulk action touches. Three states, and they are not
 * interchangeable: `undefined` is the whole inbox, `null` is the app-wide rows
 * (the ones that belong to no project), a string is that one project.
 */
export type NotificationScope = string | null;

export interface NotificationsSlice {
  notifications: Notification[];
  /** Unread across every project. Independent of any active filter. */
  notificationsUnreadCount: number;
  /** Highest row id drained so far — where the next drain starts. */
  notificationsCursor: number;
  notificationsStatus: 'idle' | 'loading' | 'error';

  dispatchNotification: (input: NotificationInput) => Promise<Notification | null>;
  drainNotifications: () => Promise<void>;
  reloadNotifications: () => Promise<void>;
  markNotificationRead: (uid: string) => Promise<void>;
  /** See {@link NotificationScope} for what the argument means. */
  markAllNotificationsRead: (projectPath?: NotificationScope) => Promise<void>;
  answerNotification: (uid: string, answer: string) => Promise<void>;
  clearNotifications: (projectPath?: NotificationScope) => Promise<void>;
  dismissNotification: (uid: string) => Promise<void>;
}

/** Rows that never reached the database carry this id, so they can never move the cursor. */
const LOCAL_ONLY_ID = 0;

let localUidCounter = 0;

function localUid(): string {
  return `local-${++localUidCounter}`;
}

function unreadCount(notifications: Notification[]): number {
  return notifications.reduce((n, notification) => n + (notification.readAt === null ? 1 : 0), 0);
}

/** Newest first, with the row id breaking ties within the same second. */
function byNewest(a: Notification, b: Notification): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
}

/**
 * Folds incoming rows into the list.
 *
 * Incoming always wins: it came from the database, the list is a cache of it.
 * A row is replaced when it shares a `uid` — and also when it shares a
 * non-null `dedupeKey`, which covers rows bumped by another process, where
 * the client cannot know the two are the same notification by uid alone.
 */
export function mergeNotifications(
  existing: Notification[],
  incoming: Notification[]
): Notification[] {
  if (incoming.length === 0) return existing;

  const uids = new Set(incoming.map((n) => n.uid));
  const dedupeKeys = new Set(
    incoming.map((n) => n.dedupeKey).filter((key): key is string => key !== null)
  );

  const kept = existing.filter(
    (n) => !uids.has(n.uid) && !(n.dedupeKey !== null && dedupeKeys.has(n.dedupeKey))
  );

  return [...kept, ...incoming].sort(byNewest);
}

/** Whether a row falls inside the scope a bulk action was given. */
function inScope(notification: Notification, scope: NotificationScope | undefined): boolean {
  return scope === undefined || notification.projectPath === scope;
}

/** A question nobody has answered. Bulk clears go around these. */
function isOpenQuestion(notification: Notification): boolean {
  return notification.kind === 'ask' && notification.answeredAt === null;
}

function highestId(notifications: Notification[]): number {
  return notifications.reduce((max, n) => Math.max(max, n.id), 0);
}

export const createNotificationsSlice: StateCreator<NotificationsSlice> = (set, get) => ({
  notifications: [],
  notificationsUnreadCount: 0,
  notificationsCursor: 0,
  notificationsStatus: 'idle',

  /**
   * Writes a notification and shows it at once. The backend's answer is
   * authoritative — it decides the uid, the id and whether this collapsed
   * into an existing row.
   *
   * Without a backend (browser mode, tests) the notification still enters the
   * list, marked as local-only. Losing the message entirely would be the worse
   * failure: the point of the inbox is that nothing said gets dropped.
   *
   * A banner is raised for the same message when it earns one and the window
   * is not focused — see `deservesOsBanner`. It is fire-and-forget: whether the
   * OS shows it changes nothing about the record.
   */
  dispatchNotification: async (input) => {
    const severity = input.severity ?? 'info';
    const kind = input.kind ?? 'info';
    if (deservesOsBanner(severity, kind, input.source)) {
      void notifyOs(input.title, input.body ?? '');
    }

    try {
      const stored = await notificationsDispatch(input);
      const notifications = mergeNotifications(get().notifications, [stored]);
      set({
        notifications,
        notificationsUnreadCount: unreadCount(notifications),
        notificationsCursor: Math.max(get().notificationsCursor, stored.id),
      });
      return stored;
    } catch {
      const local: Notification = {
        id: LOCAL_ONLY_ID,
        uid: input.uid ?? localUid(),
        createdAt: new Date().toISOString(),
        projectPath: input.projectPath ?? null,
        projectName: input.projectName ?? null,
        source: input.source,
        origin: input.origin ?? null,
        kind: input.kind ?? 'info',
        severity: input.severity ?? 'info',
        title: input.title,
        body: input.body ?? null,
        actions: input.actions ?? [],
        dedupeKey: input.dedupeKey ?? null,
        refKind: input.refKind ?? null,
        refId: input.refId ?? null,
        readAt: null,
        answeredAt: null,
        answer: null,
        expiresAt: input.expiresAt ?? null,
      };
      const notifications = mergeNotifications(get().notifications, [local]);
      set({ notifications, notificationsUnreadCount: unreadCount(notifications) });
      return null;
    }
  },

  /**
   * Picks up everything written since the cursor, including by other processes.
   *
   * This is the only path a schedule's notification takes — it is written in
   * Rust, so `dispatchNotification` never sees it and never raised its banner.
   * Without one here, a reminder that fires while the window is in the
   * background waits, silent, until the user happens to look at the inbox,
   * which is precisely the moment they did not want to depend on.
   *
   * `reloadNotifications` stays silent on purpose: it reads the whole table,
   * so banners there would announce a week of history on every start.
   */
  drainNotifications: async () => {
    try {
      const incoming = await notificationsList({ sinceId: get().notificationsCursor });
      if (incoming.length === 0) return;
      const banner = osBannerForBatch(incoming);
      if (banner) void notifyOs(banner.title, banner.body);
      const notifications = mergeNotifications(get().notifications, incoming);
      set({
        notifications,
        notificationsUnreadCount: unreadCount(notifications),
        notificationsCursor: Math.max(get().notificationsCursor, highestId(incoming)),
        notificationsStatus: 'idle',
      });
    } catch {
      set({ notificationsStatus: 'error' });
    }
  },

  /** Full reload — for startup, and for recovering from a failed drain. */
  reloadNotifications: async () => {
    set({ notificationsStatus: 'loading' });
    try {
      const notifications = await notificationsList();
      set({
        notifications: [...notifications].sort(byNewest),
        notificationsUnreadCount: unreadCount(notifications),
        notificationsCursor: highestId(notifications),
        notificationsStatus: 'idle',
      });
    } catch {
      set({ notificationsStatus: 'error' });
    }
  },

  markNotificationRead: async (uid) => {
    const target = get().notifications.find((n) => n.uid === uid);
    if (!target || target.readAt !== null) return;

    const readAt = new Date().toISOString();
    const notifications = get().notifications.map((n) => (n.uid === uid ? { ...n, readAt } : n));
    set({ notifications, notificationsUnreadCount: unreadCount(notifications) });

    try {
      await notificationsMarkRead([uid]);
    } catch {
      // Browser mode, or the row is already gone. Keeping it read locally is
      // the honest outcome — the user did look at it.
    }
  },

  /**
   * Reads away a whole scope at once.
   *
   * The backend's mark-all takes a project path and reads a *missing* one as
   * "every project" — so `null`, which means the opposite (only the rows that
   * belong to no project), cannot be expressed through it. Those rows are named
   * one by one instead. Handing the backend a null there would mark every
   * project read from a button that claims to touch one group.
   */
  markAllNotificationsRead: async (projectPath) => {
    const readAt = new Date().toISOString();
    const targets = get().notifications.filter((n) => n.readAt === null && inScope(n, projectPath));
    const notifications = get().notifications.map((n) =>
      n.readAt === null && inScope(n, projectPath) ? { ...n, readAt } : n
    );
    set({ notifications, notificationsUnreadCount: unreadCount(notifications) });

    try {
      if (projectPath === null) {
        if (targets.length > 0) await notificationsMarkRead(targets.map((n) => n.uid));
      } else {
        await notificationsMarkAllRead(projectPath);
      }
    } catch {
      /* see markNotificationRead */
    }
  },

  /**
   * Records the decision. Answering also counts as reading, and an answer is
   * written once — a settled question keeps the reply a waiting agent already
   * read back.
   */
  answerNotification: async (uid, answer) => {
    const target = get().notifications.find((n) => n.uid === uid);
    if (!target || target.answeredAt !== null) return;

    const now = new Date().toISOString();
    const notifications = get().notifications.map((n) =>
      n.uid === uid ? { ...n, answer, answeredAt: now, readAt: n.readAt ?? now } : n
    );
    set({ notifications, notificationsUnreadCount: unreadCount(notifications) });

    try {
      await notificationsAnswer(uid, answer);
    } catch {
      /* see markNotificationRead */
    }
  },

  /**
   * Tidies away what has been dealt with, within one scope. Unanswered
   * questions stay whatever the scope: clearing the list is not an answer, and
   * a dropped question is one an agent waits on forever.
   *
   * The app-wide scope (`null`) is the one `notifications_clear` cannot
   * express — a missing project path means "every project" there — so those
   * rows are deleted by name instead. The backend keeps the open-question
   * guard in that path too, so the rule holds even for a caller that forgot.
   */
  clearNotifications: async (projectPath) => {
    const cleared = get().notifications.filter(
      (n) => inScope(n, projectPath) && !isOpenQuestion(n)
    );
    const notifications = get().notifications.filter(
      (n) => !inScope(n, projectPath) || isOpenQuestion(n)
    );
    set({ notifications, notificationsUnreadCount: unreadCount(notifications) });

    try {
      if (projectPath === null) {
        if (cleared.length > 0) await notificationsDelete(cleared.map((n) => n.uid));
      } else {
        await notificationsClear(projectPath);
      }
    } catch {
      /* see markNotificationRead */
    }
  },

  /**
   * One row, gone — the "confirm and remove" button on the row itself, so
   * clearing a single item never requires opening the Command Center.
   *
   * Same open-question guard as `clearNotifications`: dismissing is not an
   * answer, and a question an agent is waiting on must not disappear just
   * because it was in the way.
   */
  dismissNotification: async (uid) => {
    const target = get().notifications.find((n) => n.uid === uid);
    if (!target || isOpenQuestion(target)) return;

    const notifications = get().notifications.filter((n) => n.uid !== uid);
    set({ notifications, notificationsUnreadCount: unreadCount(notifications) });

    try {
      await notificationsDelete([uid]);
    } catch {
      /* see markNotificationRead */
    }
  },
});

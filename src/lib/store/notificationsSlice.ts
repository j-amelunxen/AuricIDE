import type { StateCreator } from 'zustand';
import type { Notification } from '@/lib/notifications/types';
import { deservesOsBanner, notifyOs } from '@/lib/notifications/os';
import {
  notificationsAnswer,
  notificationsClear,
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
export interface NotificationsSlice {
  notifications: Notification[];
  /** Unread across every project. Independent of any active filter. */
  notificationsUnreadCount: number;
  /** Highest row id drained so far — where the next drain starts. */
  notificationsCursor: number;
  notificationsStatus: 'idle' | 'loading' | 'error';
  /** Display filter only. Never narrows the count. */
  notificationsProjectFilter: string | null;

  dispatchNotification: (input: NotificationInput) => Promise<Notification | null>;
  drainNotifications: () => Promise<void>;
  reloadNotifications: () => Promise<void>;
  markNotificationRead: (uid: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  answerNotification: (uid: string, answer: string) => Promise<void>;
  clearNotifications: () => Promise<void>;
  setNotificationsProjectFilter: (projectPath: string | null) => void;
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

function highestId(notifications: Notification[]): number {
  return notifications.reduce((max, n) => Math.max(max, n.id), 0);
}

export const createNotificationsSlice: StateCreator<NotificationsSlice> = (set, get) => ({
  notifications: [],
  notificationsUnreadCount: 0,
  notificationsCursor: 0,
  notificationsStatus: 'idle',
  notificationsProjectFilter: null,

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
    if (deservesOsBanner(severity, kind)) {
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

  /** Picks up everything written since the cursor, including by other processes. */
  drainNotifications: async () => {
    try {
      const incoming = await notificationsList({ sinceId: get().notificationsCursor });
      if (incoming.length === 0) return;
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

  markAllNotificationsRead: async () => {
    const readAt = new Date().toISOString();
    const notifications = get().notifications.map((n) =>
      n.readAt === null ? { ...n, readAt } : n
    );
    set({ notifications, notificationsUnreadCount: 0 });

    try {
      await notificationsMarkAllRead();
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
   * Tidies away what has been dealt with. Unanswered questions stay: clearing
   * the list is not an answer, and a dropped question is one an agent waits on
   * forever.
   */
  clearNotifications: async () => {
    const notifications = get().notifications.filter(
      (n) => n.kind === 'ask' && n.answeredAt === null
    );
    set({ notifications, notificationsUnreadCount: unreadCount(notifications) });

    try {
      await notificationsClear();
    } catch {
      /* see markNotificationRead */
    }
  },

  setNotificationsProjectFilter: (projectPath) => set({ notificationsProjectFilter: projectPath }),
});

/** The rows the panel shows, after the display filter. */
export function getVisibleNotifications(state: NotificationsSlice): Notification[] {
  const { notifications, notificationsProjectFilter } = state;
  if (notificationsProjectFilter === null) return notifications;
  return notifications.filter((n) => n.projectPath === notificationsProjectFilter);
}

import type {
  Notification,
  NotificationAction,
  NotificationKind,
  NotificationRefKind,
  NotificationSeverity,
  NotificationSource,
} from '@/lib/notifications/types';
import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

export type { Notification };

/**
 * What a dispatcher supplies. The store owns everything else — id, uid,
 * timestamps, read state — so none of it appears here.
 */
export interface NotificationInput {
  /** Only set to claim a specific identity; otherwise the backend mints one. */
  uid?: string;
  projectPath?: string | null;
  projectName?: string | null;
  source: NotificationSource;
  /** Who sent it, in words: an agent name, a schedule name. */
  origin?: string | null;
  kind?: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  actions?: NotificationAction[];
  /**
   * Collapses repeats. A second dispatch under the same key replaces the
   * first and makes it unread again, so a recurring reminder is one row that
   * gets louder rather than a stack of identical ones.
   */
  dedupeKey?: string | null;
  refKind?: NotificationRefKind | null;
  refId?: string | null;
  expiresAt?: string | null;
}

export interface NotificationListOptions {
  /** Only rows newer than this id — the drain cursor. */
  sinceId?: number;
  limit?: number;
  projectPath?: string;
}

export async function notificationsDispatch(payload: NotificationInput): Promise<Notification> {
  return invoke<Notification>('notifications_dispatch', { payload });
}

export async function notificationsList(
  options: NotificationListOptions = {}
): Promise<Notification[]> {
  return invoke<Notification[]>('notifications_list', {
    sinceId: options.sinceId ?? null,
    limit: options.limit ?? null,
    projectPath: options.projectPath ?? null,
  });
}

export async function notificationsMarkRead(uids: string[]): Promise<void> {
  return invoke<void>('notifications_mark_read', { uids });
}

export async function notificationsMarkAllRead(projectPath?: string): Promise<void> {
  return invoke<void>('notifications_mark_all_read', { projectPath: projectPath ?? null });
}

export async function notificationsAnswer(uid: string, answer: string): Promise<void> {
  return invoke<void>('notifications_answer', { uid, answer });
}

export async function notificationsUnreadCount(projectPath?: string): Promise<number> {
  return invoke<number>('notifications_unread_count', { projectPath: projectPath ?? null });
}

export async function notificationsClear(projectPath?: string): Promise<void> {
  return invoke<void>('notifications_clear', { projectPath: projectPath ?? null });
}

/**
 * Fires when the inbox file changed. The payload is deliberately empty: the
 * writer may be another process (the MCP server, a second instance), so the
 * only honest thing the event can say is "go look". Clients then drain from
 * their own cursor.
 */
export function onNotificationsChanged(callback: () => void): () => void {
  return subscribeToTauriEvent<unknown>(
    'notifications-changed',
    () => callback(),
    '[Browser mode] Notification listener not available'
  );
}

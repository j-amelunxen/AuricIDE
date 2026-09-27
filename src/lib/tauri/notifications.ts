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

/** What became of an agent launch request; see `record_launch_run_impl`. */
export interface AgentLaunchRunInput {
  requestUid: string;
  agentId: string;
  agentName?: string | null;
  provider?: string | null;
  model?: string | null;
  status: 'running' | 'interrupted' | 'completed' | 'failed' | 'killed';
  summary?: string | null;
  error?: string | null;
  /** The frontend's writes: they add the summary, never a status. */
  summaryOnly?: boolean;
}

export async function notificationsRecordLaunchRun(input: AgentLaunchRunInput): Promise<void> {
  return invoke<void>('notifications_record_launch_run', { input });
}

/** A launch grant in force, as `agent_launch_grants` stores it. */
export interface LaunchGrant {
  id: string;
  /** Project folder the grant is bound to; requests from any other are foreign. */
  projectPath: string;
  rootGoalId: string;
  /** Snapshot for display; the id decides. */
  rootGoalName: string;
  /** Agents started for this mission that may run at the same time. */
  maxConcurrent: number;
  /** Automatic starts this grant pays for in total; then it is spent. */
  launchBudget: number;
  /** SQLite UTC timestamp. */
  grantedAt: string;
  /** Automatic starts this grant has paid for, counted by the native claim. */
  launchesUsed: number;
}

export interface LaunchGrantInput {
  id: string;
  projectPath: string;
  rootGoalId: string;
  rootGoalName: string;
  maxConcurrent: number;
  launchBudget: number;
}

/** Stores a grant (replacing the one for the same root); resolves with the row. */
export async function notificationsSaveLaunchGrant(input: LaunchGrantInput): Promise<LaunchGrant> {
  return invoke<LaunchGrant>('notifications_save_launch_grant', { input });
}

export async function notificationsRevokeLaunchGrant(grantId: string): Promise<void> {
  return invoke<void>('notifications_revoke_launch_grant', { grantId });
}

export async function notificationsListLaunchGrants(projectPath?: string): Promise<LaunchGrant[]> {
  return invoke<LaunchGrant[]>('notifications_list_launch_grants', {
    projectPath: projectPath ?? null,
  });
}

/**
 * One automatic start a launch grant wants; see `claim_launch_impl`. Only the
 * ids travel: the claim reads limits, project and root from the grant row and
 * the goal from the request row.
 */
export interface AgentLaunchClaimInput {
  requestUid: string;
  grantId: string;
}

/** Only `claimed` may lead to a spawn. */
export type LaunchClaimOutcome =
  | 'claimed'
  | 'no-grant'
  | 'outside-root'
  | 'already-claimed'
  | 'at-capacity'
  | 'budget-spent'
  | 'not-a-request';

/**
 * The atomic gate before an automatic start: checks the grant row and the
 * goal tree, takes the request, books the budget and reserves a slot in one
 * transaction, across app instances.
 */
export async function notificationsClaimLaunch(
  input: AgentLaunchClaimInput
): Promise<LaunchClaimOutcome> {
  return invoke<LaunchClaimOutcome>('notifications_claim_launch', { input });
}

/** Frees the slot of a claimed start that did not happen. The budget stays spent. */
export async function notificationsReleaseLaunchClaim(requestUid: string): Promise<void> {
  return invoke<void>('notifications_release_launch_claim', { requestUid });
}

export async function notificationsUnreadCount(projectPath?: string): Promise<number> {
  return invoke<number>('notifications_unread_count', { projectPath: projectPath ?? null });
}

export async function notificationsClear(projectPath?: string): Promise<void> {
  return invoke<void>('notifications_clear', { projectPath: projectPath ?? null });
}

/**
 * Deletes the named rows. Unanswered questions among them are left standing
 * by the backend — the same rule `notifications_clear` applies.
 */
export async function notificationsDelete(uids: string[]): Promise<void> {
  return invoke<void>('notifications_delete', { uids });
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

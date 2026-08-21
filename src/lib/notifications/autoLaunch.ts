import { isFreshOccurrence } from '@/lib/conductor/scheduledRun';
import { notificationTrust } from './trust';
import type { Notification, NotificationAction } from './types';

type AutoAgentAction =
  | Extract<NotificationAction, { kind: 'spawn-agent' }>
  | Extract<NotificationAction, { kind: 'run-skill' }>;

function isEligibleAutoStart(notification: Notification, nowMs: number): boolean {
  return (
    notification.readAt === null &&
    notification.answeredAt === null &&
    notificationTrust(notification.source) === 'user' &&
    isFreshOccurrence(notification.dedupeKey, nowMs)
  );
}

function isAutoAgentAction(action: NotificationAction): action is AutoAgentAction {
  return (action.kind === 'spawn-agent' || action.kind === 'run-skill') && action.launch === 'auto';
}

/**
 * The `spawn-agent` and `run-skill` actions in a notification batch that
 * qualify for an automatic start: a user-authored payload, still unread and
 * unanswered, whose occurrence is fresh, and whose action explicitly asks for
 * `launch: 'auto'`.
 *
 * Unlike conductor auto-start this does not wait for an idle IDE and does not
 * switch the open project — the agent runs in `repoPath` / `cwd` as it is.
 * Catch-up rows and model-written payloads stay a button.
 */
export function autoAgentLaunches(
  notifications: Notification[],
  parse: (notification: Notification) => NotificationAction[],
  nowMs: number
): Array<{ notification: Notification; action: AutoAgentAction }> {
  const launches: Array<{ notification: Notification; action: AutoAgentAction }> = [];

  for (const notification of notifications) {
    if (!isEligibleAutoStart(notification, nowMs)) continue;

    for (const action of parse(notification)) {
      if (isAutoAgentAction(action)) {
        launches.push({ notification, action });
      }
    }
  }

  return launches;
}

/**
 * OS-level notifications for the conductor's "away moments" — the events that
 * matter when the user has started the conductor and walked away: the loop is
 * parked on a human approval, the goal is achieved, the run is blocked, or the
 * run is done. Suppressed while the window has focus (the panel already shows
 * the same state), and a silent no-op in browser mode.
 */

import { notifyOs } from '../notifications/os';

export type ConductorNotificationEvent =
  'approval_needed' | 'goal_achieved' | 'goal_blocked' | 'run_finished';

export interface ConductorNotificationContent {
  title: string;
  body: string;
}

export function conductorNotificationContent(
  event: ConductorNotificationEvent,
  detail: string
): ConductorNotificationContent {
  switch (event) {
    case 'approval_needed':
      return {
        title: 'Conductor needs your approval',
        body: `"${detail}" is waiting for launch approval.`,
      };
    case 'goal_achieved':
      return {
        title: 'Goal achieved',
        body: `"${detail}": all checks green.`,
      };
    case 'goal_blocked':
      return {
        title: 'Conductor stopped: goal not satisfied',
        body: detail,
      };
    case 'run_finished':
      return {
        title: 'Conductor finished',
        body: 'All unblocked tickets processed.',
      };
  }
}

export async function notifyConductor(
  event: ConductorNotificationEvent,
  detail: string
): Promise<void> {
  // Focus suppression, permission handling and browser-mode safety all live in
  // notifyOs now, so the conductor and the inbox cannot drift apart on when a
  // banner is appropriate.
  const { title, body } = conductorNotificationContent(event, detail);
  await notifyOs(title, body);
}

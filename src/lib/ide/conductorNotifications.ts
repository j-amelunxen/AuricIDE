/**
 * OS-level notifications for the conductor's "away moments" — the events that
 * matter when the user has started the conductor and walked away: the loop is
 * parked on a human approval, the goal is achieved, the run is blocked, or the
 * run is done. Suppressed while the window has focus (the panel already shows
 * the same state), and a silent no-op in browser mode.
 */

export type ConductorNotificationEvent =
  | 'approval_needed'
  | 'goal_achieved'
  | 'goal_blocked'
  | 'run_finished';

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
  // Focused window ⇒ the conductor panel is already telling the story.
  if (typeof document !== 'undefined' && document.hasFocus()) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (!granted) return;
    sendNotification(conductorNotificationContent(event, detail));
  } catch {
    // Browser mode / plugin unavailable — the in-app decision log still has it
  }
}

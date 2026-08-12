import type { NotificationKind, NotificationSeverity } from './types';

/**
 * The one path to an OS-level banner.
 *
 * Suppressed while the window has focus, because a banner then duplicates
 * something already on screen — and a notification you have already seen is
 * the fastest way to teach yourself to dismiss banners unread. A silent no-op
 * in browser mode and wherever the plugin is unavailable: the inbox has the
 * message either way, the banner is only the tap on the shoulder.
 */
export async function notifyOs(title: string, body: string): Promise<void> {
  if (typeof document !== 'undefined' && document.hasFocus()) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (!granted) return;
    sendNotification({ title, body });
  } catch {
    // Plugin unavailable — the inbox still has it.
  }
}

/**
 * Whether a notification is worth a banner.
 *
 * Failures and things waiting on a decision earn one; routine progress does
 * not. This is the same rule the fleet panel follows — "failures interrupt
 * once; successes never do" — applied to the inbox, so a run of green results
 * never trains you to ignore the banner that finally matters.
 */
export function deservesOsBanner(severity: NotificationSeverity, kind: NotificationKind): boolean {
  return kind === 'ask' || severity === 'error' || severity === 'warn';
}

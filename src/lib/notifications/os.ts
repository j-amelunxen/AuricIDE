import type { NotificationKind, NotificationSeverity, NotificationSource } from './types';

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
 *
 * A schedule is the exception, and not really an exception at all: a reminder
 * exists *to* interrupt. Its severity is `info` because nothing has gone wrong,
 * but a reminder only seen by someone already looking at the inbox has not
 * reminded anyone of anything.
 */
export function deservesOsBanner(
  severity: NotificationSeverity,
  kind: NotificationKind,
  source: NotificationSource | string
): boolean {
  if (source === 'system') return true;
  return kind === 'ask' || severity === 'error' || severity === 'warn';
}

export interface OsBanner {
  title: string;
  body: string;
}

/** Enough of a notification to decide on, and to word, a banner. */
type BannerCandidate = {
  severity: NotificationSeverity;
  kind: NotificationKind;
  source: NotificationSource | string;
  title: string;
  body: string | null;
};

/**
 * The single banner for one batch of arrivals.
 *
 * One notification gets its own words. Several become one line that counts
 * them, because a machine that was asleep over a weekend can hand over a
 * dozen at once, and a dozen banners is a thing you dismiss without reading —
 * which costs you the one that mattered. Nothing is hidden by this: the inbox
 * still holds every entry and the unread count still says how many.
 */
export function osBannerForBatch(incoming: BannerCandidate[]): OsBanner | null {
  const worthy = incoming.filter((n) => deservesOsBanner(n.severity, n.kind, n.source));
  if (worthy.length === 0) return null;

  const first = worthy[0];
  if (worthy.length === 1) return { title: first.title, body: first.body ?? '' };
  return {
    title: `${worthy.length} new notifications`,
    body: worthy
      .slice(0, 3)
      .map((n) => n.title)
      .join(' · '),
  };
}

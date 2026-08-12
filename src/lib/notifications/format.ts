import type { NotificationSeverity } from './types';

/**
 * Turns a stored timestamp into a Date.
 *
 * Two formats reach us and they must not be confused. SQLite's `datetime('now')`
 * writes `YYYY-MM-DD HH:MM:SS` in **UTC**, while a row that never reached the
 * database carries a full ISO string. Handed the space-separated form, JS parses
 * it as *local* time — so a UTC timestamp would be read as local and every age
 * would be off by the offset, showing entries as minted in the future during
 * summer in Berlin. Normalising here is the only place that has to know.
 *
 * Returns null for anything unparseable, so a corrupt row loses its age rather
 * than rendering "NaN" or an epoch date.
 */
export function parseNotificationTimestamp(raw: string): Date | null {
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;

  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * How long ago, in as few characters as possible — these sit in a narrow
 * side panel next to text that matters more.
 */
export function formatNotificationAge(createdAt: string, now: number): string {
  const at = parseNotificationTimestamp(createdAt);
  if (at === null) return '';

  // Clock skew between the database and the UI would otherwise read as a
  // negative age; "now" is the honest answer for anything not yet past.
  const seconds = Math.max(0, Math.floor((now - at.getTime()) / 1000));
  if (seconds < 60) return 'jetzt';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return `${Math.floor(days / 7)}w`;
}

/** The project a row belongs to, in words. */
export function formatNotificationProject(
  projectName: string | null,
  projectPath: string | null
): string {
  if (projectName !== null && projectName !== '') return projectName;
  if (projectPath !== null && projectPath !== '') {
    return projectPath.split('/').filter(Boolean).pop() ?? projectPath;
  }
  return 'App';
}

export interface SeverityTone {
  icon: string;
  /** Text colour for the icon. */
  color: string;
  /** Left-edge marker, so severity is readable without reading the text. */
  edge: string;
}

/**
 * Severity owns the icon and the left edge. Deliberately the same palette the
 * fleet panel uses for status — amber for "look at this", red for broken,
 * emerald for done — so one colour means one thing across the app.
 */
export const SEVERITY_TONE: Record<NotificationSeverity, SeverityTone> = {
  info: { icon: 'info', color: 'text-foreground-muted', edge: 'bg-white/15' },
  success: { icon: 'check_circle', color: 'text-[#2effa5]/70', edge: 'bg-[#2effa5]/50' },
  warn: { icon: 'warning', color: 'text-[#ffce2e]', edge: 'bg-[#ffce2e]/60' },
  error: { icon: 'error', color: 'text-[#ff4a4a]', edge: 'bg-[#ff4a4a]/70' },
};

export function severityTone(severity: NotificationSeverity): SeverityTone {
  return SEVERITY_TONE[severity] ?? SEVERITY_TONE.info;
}

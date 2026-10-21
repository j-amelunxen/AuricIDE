const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const RELATIVE_LIMIT_DAYS = 30;
const LOCALE = 'en-US';

/** "5 min ago" up to a month, then a calendar date (with the year once it is not this one). */
export function relativeDate(unixSeconds: number, nowMs: number, timeZone?: string): string {
  const age = Math.max(0, nowMs / 1000 - unixSeconds);
  if (age < MINUTE) return 'now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  if (age < 2 * DAY) return 'Yesterday';
  if (age < RELATIVE_LIMIT_DAYS * DAY) return `${Math.floor(age / DAY)} d ago`;
  const date = new Date(unixSeconds * 1000);
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone,
  }).format(date);
}

/** For the hover title: the exact moment, so the relative text is never the only record. */
export function absoluteDate(unixSeconds: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(unixSeconds * 1000));
}

const DUE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A calendar date the inbox can store: `YYYY-MM-DD`, and a real day. */
export function isValidDueDate(value: string): boolean {
  const match = DUE_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Blank becomes null. An invalid string is dropped rather than stored. */
export function normalizeDueDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return isValidDueDate(trimmed) ? trimmed : null;
}

/** Compare against the local calendar day of `now`, not a UTC midnight. */
function localIsoDate(now: number): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDueDateOverdue(dueDate: string | null, now: number): boolean {
  if (dueDate === null) return false;
  return dueDate < localIsoDate(now);
}

export function formatInboxDueDate(dueDate: string): string {
  const match = DUE_DATE_RE.exec(dueDate);
  if (!match) return dueDate;
  const day = Number(match[3]);
  const month = MONTH_LABELS[Number(match[2]) - 1];
  return `${day} ${month}`;
}

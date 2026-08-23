import type { Priority } from '@/lib/pm/enums';
import type { InboxItem } from '@/lib/tauri/inbox';

/**
 * In the order the picker offers them, which is also the order of how often
 * the answer is wanted: what is most urgent, what is due next, what is newest.
 */
export const INBOX_SORTS = ['priority', 'dueDate', 'created'] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];

/**
 * What the inbox opens with.
 *
 * An inbox is a triage list, so the first row should be the one that would be
 * picked up first — not merely the one captured last. Capture order stays one
 * click away, and the choice is remembered, so this only decides the very
 * first look.
 */
export const INBOX_DEFAULT_SORT: InboxSort = 'priority';

export const INBOX_SORT_LABEL: Record<InboxSort, string> = {
  created: 'Newest',
  dueDate: 'Due date',
  priority: 'Priority',
};

/** A stored (or absent, or stale) preference read back as a sort we offer. */
export function parseInboxSort(raw: string | null | undefined): InboxSort {
  return (INBOX_SORTS as readonly string[]).includes(raw ?? '')
    ? (raw as InboxSort)
    : INBOX_DEFAULT_SORT;
}

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function priorityRank(priority: InboxItem['priority']): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal;
}

function compareCreatedNewestFirst(a: InboxItem, b: InboxItem): number {
  return b.createdAt.localeCompare(a.createdAt);
}

function compareDueDate(a: InboxItem, b: InboxItem): number {
  if (a.dueDate === null && b.dueDate === null) return compareCreatedNewestFirst(a, b);
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  const byDue = a.dueDate.localeCompare(b.dueDate);
  return byDue !== 0 ? byDue : compareCreatedNewestFirst(a, b);
}

/** A new list — never mutates `items`. */
export function sortInboxItems(items: InboxItem[], sort: InboxSort): InboxItem[] {
  const copy = items.slice();
  copy.sort((a, b) => {
    if (sort === 'created') return compareCreatedNewestFirst(a, b);
    if (sort === 'dueDate') return compareDueDate(a, b);
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    return byPriority !== 0 ? byPriority : compareDueDate(a, b);
  });
  return copy;
}

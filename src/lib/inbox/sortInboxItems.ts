import type { Priority } from '@/lib/pm/enums';
import type { InboxItem } from '@/lib/tauri/inbox';

export const INBOX_SORTS = ['created', 'dueDate', 'priority'] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];

export const INBOX_SORT_LABEL: Record<InboxSort, string> = {
  created: 'Newest',
  dueDate: 'Due date',
  priority: 'Priority',
};

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

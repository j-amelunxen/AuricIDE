import type { Priority } from '@/lib/pm/enums';
import type { PmTicket } from '@/lib/tauri/pm';

/**
 * How the ticket table can be ordered. `custom` is the drag-and-drop order
 * stored as `sortOrder`; the others are views over the same rows, and
 * switching back to custom restores that stored order.
 */
export const TICKET_SORTS = ['custom', 'name', 'status', 'priority', 'createdAt'] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];

export const TICKET_DEFAULT_SORT: TicketSort = 'custom';

export const TICKET_SORT_LABEL: Record<TicketSort, string> = {
  custom: 'Custom',
  name: 'Name',
  status: 'Status',
  priority: 'Priority',
  createdAt: 'Created',
};

/** A stored (or absent, or stale) preference read back as a sort we offer. */
export function parseTicketSort(raw: string | null | undefined): TicketSort {
  return (TICKET_SORTS as readonly string[]).includes(raw ?? '')
    ? (raw as TicketSort)
    : TICKET_DEFAULT_SORT;
}

const PRIORITY_VALUE: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

function compare(a: PmTicket, b: PmTicket, sort: TicketSort): number {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'status':
      return a.status.localeCompare(b.status);
    case 'priority':
      return PRIORITY_VALUE[a.priority] - PRIORITY_VALUE[b.priority];
    case 'createdAt':
      return a.createdAt.localeCompare(b.createdAt);
    case 'custom':
    default:
      return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
  }
}

/** A new list — never mutates `tickets`. */
export function sortTickets(tickets: PmTicket[], sort: TicketSort, ascending = true): PmTicket[] {
  const copy = tickets.slice();
  copy.sort((a, b) => {
    const cmp = compare(a, b, sort);
    return ascending ? cmp : -cmp;
  });
  return copy;
}

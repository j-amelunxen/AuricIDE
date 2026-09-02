import { TICKET_STATUSES, type TicketStatus } from './enums';
import { TICKET_STATUS_LABEL } from './ticketStatusStyle';

/** Longer names for a picker — the chip stays compact (`IP`), the menu does not. */
const TICKET_STATUS_MENU_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  to_test: 'To test',
  in_review: 'In review',
  done: 'Done',
  archived: 'Archived',
  discarded: 'Discarded',
};

export function isKnownTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export function ticketStatusChoices(current: TicketStatus | 'unknown'): Array<{
  status: TicketStatus;
  label: string;
  selected: boolean;
}> {
  return TICKET_STATUSES.map((status) => ({
    status,
    label: TICKET_STATUS_MENU_LABEL[status],
    selected: current === status,
  }));
}

export function ticketStatusChipLabel(status: TicketStatus | 'unknown'): string {
  if (status === 'unknown' || !isKnownTicketStatus(status)) return 'Unknown';
  return TICKET_STATUS_LABEL[status];
}

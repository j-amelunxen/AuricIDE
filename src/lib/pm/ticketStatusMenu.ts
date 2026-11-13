import { TICKET_STATUSES, type TicketStatus } from './enums';
import { TICKET_STATUS_LABEL } from './ticketStatusStyle';
import { TICKET_STATUS_NAME } from './labels';

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
    label: TICKET_STATUS_NAME[status],
    selected: current === status,
  }));
}

export function ticketStatusChipLabel(status: TicketStatus | 'unknown'): string {
  if (status === 'unknown' || !isKnownTicketStatus(status)) return 'Unknown';
  return TICKET_STATUS_LABEL[status];
}

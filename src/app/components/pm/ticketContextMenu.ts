import type { PmTicket } from '@/lib/pm/types';
import type { ContextMenuOption } from '../../../lib/ui/contextMenu';
import { PRIORITY_NAME } from '@/lib/pm/labels';

export const priorityIcon: Record<PmTicket['priority'], string> = {
  low: 'keyboard_double_arrow_down',
  normal: 'remove',
  high: 'keyboard_double_arrow_up',
  critical: 'priority_high',
};

/**
 * Status / Priority / Agent strength sections shared by the ticket context menus
 * in TicketTable and DependencyTreeView. Callers append their own trailing options.
 */
export function buildTicketStatusPriorityPowerOptions(
  ticket: PmTicket,
  onUpdateTicket: (id: string, updates: Partial<PmTicket>) => void
): ContextMenuOption[] {
  const options: ContextMenuOption[] = [];

  options.push({ type: 'header', label: 'Status' });

  if (ticket.status === 'open') {
    options.push({
      label: 'Start Work',
      icon: 'play_arrow',
      action: () => onUpdateTicket(ticket.id, { status: 'in_progress' }),
    });
  } else if (ticket.status === 'in_progress') {
    options.push({
      label: 'Mark to Test',
      icon: 'science',
      action: () => onUpdateTicket(ticket.id, { status: 'to_test' }),
    });
    options.push({
      label: 'Mark as Done',
      icon: 'check_circle',
      action: () => onUpdateTicket(ticket.id, { status: 'done' }),
    });
  } else if (ticket.status === 'to_test') {
    options.push({
      label: 'Mark as Done',
      icon: 'check_circle',
      action: () => onUpdateTicket(ticket.id, { status: 'done' }),
    });
  } else if (
    ticket.status === 'done' ||
    ticket.status === 'archived' ||
    ticket.status === 'discarded'
  ) {
    options.push({
      label: 'Reopen',
      icon: 'history',
      action: () => onUpdateTicket(ticket.id, { status: 'open' }),
    });
  }

  if (ticket.status !== 'archived') {
    options.push({
      label: 'Archive',
      icon: 'archive',
      action: () => onUpdateTicket(ticket.id, { status: 'archived' }),
    });
  }

  if (ticket.status !== 'discarded') {
    options.push({
      label: 'Discard',
      icon: 'cancel',
      action: () => onUpdateTicket(ticket.id, { status: 'discarded' }),
    });
  }

  options.push({ type: 'separator' });

  options.push({ type: 'header', label: 'Priority' });
  (['low', 'normal', 'high', 'critical'] as const).forEach((p) => {
    options.push({
      label: PRIORITY_NAME[p],
      icon: priorityIcon[p],
      action: () => onUpdateTicket(ticket.id, { priority: p }),
      ...(ticket.priority === p ? { icon: 'check' } : {}),
    });
  });

  options.push({ type: 'separator' });

  options.push({ type: 'header', label: 'Agent strength' });
  options.push({
    label: 'None',
    icon: ticket.modelPower === undefined ? 'check' : undefined,
    action: () => onUpdateTicket(ticket.id, { modelPower: undefined }),
  });
  (['low', 'medium', 'high'] as const).forEach((mp) => {
    options.push({
      label: mp.charAt(0).toUpperCase() + mp.slice(1),
      icon: ticket.modelPower === mp ? 'check' : undefined,
      action: () => onUpdateTicket(ticket.id, { modelPower: mp }),
    });
  });

  return options;
}

'use client';

import { useState } from 'react';
import { ContextMenu } from '@/app/components/ide/ContextMenu';
import { isClosedTicketStatus, type TicketStatus } from '@/lib/pm/enums';
import { TICKET_STATUS_BADGE_CLASS, TICKET_STATUS_LABEL } from '@/lib/pm/ticketStatusStyle';
import {
  isKnownTicketStatus,
  ticketStatusChoices,
  ticketStatusChipLabel,
} from '@/lib/pm/ticketStatusMenu';

const UNKNOWN_STATUS_BADGE_CLASS = 'bg-white/5 text-foreground-muted/60';

export interface TicketStatusChipProps {
  status: TicketStatus | 'unknown';
  onSetStatus?: (status: TicketStatus) => void;
}

/**
 * Compact status pill. When `onSetStatus` is set and the status is known,
 * it is a picker — same shape as the inbox priority chip.
 */
export function TicketStatusChip({ status, onSetStatus }: TicketStatusChipProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const known = isKnownTicketStatus(status);
  const label = ticketStatusChipLabel(status);
  const badgeClass = known ? TICKET_STATUS_BADGE_CLASS[status] : UNKNOWN_STATUS_BADGE_CLASS;
  const chipClass = `rounded px-1 py-0.5 normal-case tracking-normal ${badgeClass}`;
  const buttonClass = `${chipClass} hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-primary`;

  if (!known || onSetStatus === undefined) {
    return <span className={chipClass}>{label}</span>;
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Status: ${TICKET_STATUS_LABEL[status]}`}
        title="Set status"
        onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
        className={buttonClass}
      >
        {label}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          options={ticketStatusChoices(status).map((choice) => ({
            label: choice.label,
            icon: choice.selected ? 'check' : undefined,
            action: () => onSetStatus(choice.status),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

export function canMarkTicketDone(status: TicketStatus | 'unknown'): boolean {
  return isKnownTicketStatus(status) && !isClosedTicketStatus(status);
}

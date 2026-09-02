'use client';

import { TicketStatusChip } from '@/app/components/pm/TicketStatusChip';
import { priorityLabel } from '@/app/components/pm/ticketContextMenu';
import type { TicketStatus } from '@/lib/pm/enums';
import type { ProjectTicketDigest } from '@/lib/tauri/inbox';

export interface InboxOverviewTicketRowProps {
  ticket: ProjectTicketDigest;
  onSetStatus: (status: TicketStatus) => void;
}

/**
 * A live ticket that already lives in the project but did not come through
 * the inbox. Same status picker as an assigned inbox row, without capture
 * chrome (attachments, unassign, dismiss).
 */
export function InboxOverviewTicketRow({ ticket, onSetStatus }: InboxOverviewTicketRowProps) {
  return (
    <div
      data-testid={`inbox-overview-ticket-${ticket.id}`}
      className="relative flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-left text-[12px] text-foreground">{ticket.name}</p>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/50">
          <span className="normal-case tracking-normal">
            {priorityLabel[ticket.priority] ?? ticket.priority}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate normal-case tracking-normal">{ticket.epicName}</span>
          <span aria-hidden="true">·</span>
          <TicketStatusChip status={ticket.status} onSetStatus={onSetStatus} />
        </div>
      </div>
    </div>
  );
}

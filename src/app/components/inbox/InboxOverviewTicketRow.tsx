import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { TicketStatusChip } from '@/app/components/pm/TicketStatusChip';
import { priorityLabel } from '@/app/components/pm/ticketContextMenu';
import { setInboxTaskDragData } from '@/lib/inbox/inboxDrag';
import type { TicketStatus } from '@/lib/pm/enums';
import type { ProjectTicketDigest } from '@/lib/tauri/inbox';

export interface InboxOverviewTicketRowProps {
  ticket: ProjectTicketDigest;
  projectPath?: string;
  onSetStatus: (status: TicketStatus) => void;
  onSetDailyGoal?: () => void;
}

/**
 * A live ticket that already lives in the project but did not come through
 * the inbox. Same status picker as an assigned inbox row, without capture
 * chrome (attachments, unassign, dismiss).
 */
export function InboxOverviewTicketRow({
  ticket,
  projectPath,
  onSetStatus,
  onSetDailyGoal,
}: InboxOverviewTicketRowProps) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      data-testid={`inbox-overview-ticket-${ticket.id}`}
      draggable={Boolean(projectPath)}
      onDragStart={(e) => {
        if (projectPath) {
          setIsDragging(true);
          setInboxTaskDragData(e, {
            type: 'ticket',
            projectPath,
            ticketId: ticket.id,
          });
        }
      }}
      onDragEnd={() => setIsDragging(false)}
      title={projectPath ? 'In die Tagesziele ziehen' : undefined}
      className={`relative flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 transition-colors ${
        projectPath ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-40' : ''}`}
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

      {onSetDailyGoal && (
        <button
          type="button"
          title="Als Tagesziel setzen"
          aria-label="Als Tagesziel setzen"
          onClick={onSetDailyGoal}
          className="rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-amber-400 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <AuricIcon name="flag" className="text-[13px]" />
        </button>
      )}
    </div>
  );
}

'use client';

import type { PmTicket } from '@/lib/tauri/pm';
import type { ConductorDecision } from '@/lib/store/conductorSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { DECISION_ICONS } from './conductorHelpers';

export interface ConductorApprovalsProps {
  pendingApprovals: PmTicket[];
  onApprove: (ticketId: string) => void;
  onDismiss: (ticketId: string) => void;
}

export function ConductorApprovals({
  pendingApprovals,
  onApprove,
  onDismiss,
}: ConductorApprovalsProps) {
  if (pendingApprovals.length === 0) return null;

  return (
    <div
      data-testid="conductor-approvals"
      className="mt-2 space-y-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5"
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300">
        Human approval needed
      </p>
      {pendingApprovals.map((ticket) => (
        <div key={ticket.id} className="flex items-center gap-2">
          <AuricIcon name="pan_tool" className="text-sm text-amber-400" />
          <span className="flex-1 truncate text-[11px] text-foreground">{ticket.name}</span>
          <button
            data-testid={`conductor-approve-${ticket.id}`}
            onClick={() => onApprove(ticket.id)}
            className="rounded-lg bg-green-500/20 px-2.5 py-1 text-[10px] font-bold text-green-300 hover:bg-green-500/30 transition-colors"
          >
            Approve
          </button>
          <button
            data-testid={`conductor-dismiss-${ticket.id}`}
            onClick={() => onDismiss(ticket.id)}
            className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] text-foreground-muted hover:bg-white/10 transition-colors"
          >
            Skip
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ConductorDecisionLogProps {
  expanded: boolean;
  decisions: ConductorDecision[];
}

export function ConductorDecisionLog({ expanded, decisions }: ConductorDecisionLogProps) {
  if (!expanded) return null;

  return (
    <div
      data-testid="conductor-log"
      className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-xl bg-black/30 p-2.5"
    >
      {decisions.length === 0 ? (
        <p className="text-[10px] text-foreground-muted/70">No decisions yet.</p>
      ) : (
        decisions.map((d) => {
          const meta = DECISION_ICONS[d.action];
          return (
            <div key={d.id} className="flex items-start gap-2 text-[10px]">
              <AuricIcon name={meta.icon} className={`text-[13px] ${meta.cls}`} />
              <span className="flex-1 text-foreground/80">{d.detail}</span>
              <span className="tabular-nums text-foreground-muted/60">{d.timestamp}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

import type { PmTicket } from '@/lib/tauri/pm';
import { InfoTooltip } from '../../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { AuricIcon } from '../../ui/AuricIcon';

interface TicketAdvancedTabProps {
  ticket: PmTicket;
  onUpdateTicket: (id: string, updates: Partial<PmTicket>) => void;
}

export function TicketAdvancedTab({ ticket, onUpdateTicket }: TicketAdvancedTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="working-directory"
          className="mb-1.5 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
        >
          Working Directory
          <InfoTooltip description={GUIDANCE.pm.workingDirectory} label="i" />
        </label>
        <div className="flex gap-2">
          <input
            id="working-directory"
            data-testid="ticket-working-directory"
            type="text"
            value={ticket.workingDirectory || ''}
            onChange={(e) => onUpdateTicket(ticket.id, { workingDirectory: e.target.value })}
            placeholder="Inherit from project root"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none transition-colors"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const mod = await import('@tauri-apps/plugin-dialog');
                const selected = await mod.open({ directory: true });
                if (selected) {
                  onUpdateTicket(ticket.id, { workingDirectory: selected as string });
                }
              } catch (err) {
                console.error('Failed to open directory dialog:', err);
              }
            }}
            className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-foreground-muted hover:bg-white/10 hover:text-foreground transition flex items-center gap-1.5"
          >
            <AuricIcon name="folder_open" className="text-[16px]" />
            Browse
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-foreground-muted">Agent cwd. Empty = project root.</p>
      </div>

      <div>
        <label className="mb-1.5 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
          Human Supervision
        </label>
        <button
          type="button"
          data-testid="human-supervision-toggle"
          onClick={() =>
            onUpdateTicket(ticket.id, {
              needsHumanSupervision: !ticket.needsHumanSupervision,
            })
          }
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            ticket.needsHumanSupervision
              ? 'bg-orange-500/10 border-orange-500/20 text-orange-300'
              : 'bg-white/5 border-white/10 text-foreground-muted hover:bg-white/10'
          }`}
        >
          <AuricIcon
            name={ticket.needsHumanSupervision ? 'visibility' : 'visibility_off'}
            className="text-[16px]"
          />
          {ticket.needsHumanSupervision ? 'Enabled' : 'Disabled'}
        </button>
        <p className="mt-1.5 text-[10px] text-foreground-muted">
          {ticket.needsHumanSupervision
            ? 'Needs human start. Conductor skips it.'
            : 'Conductor can pick this up.'}
        </p>
      </div>
    </div>
  );
}

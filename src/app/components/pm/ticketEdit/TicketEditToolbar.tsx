import type { PmEpic, PmTicket } from '@/lib/tauri/pm';
import { AuricIcon } from '../../ui/AuricIcon';
import { statusOptions } from './types';

interface TicketEditToolbarProps {
  ticket: PmTicket;
  epics: PmEpic[];
  pmDirty: boolean;
  copied: boolean;
  onUpdateTicket: (id: string, updates: Partial<PmTicket>) => void;
  onMoveTicket: (ticketId: string, newEpicId: string) => void;
  onCancel?: () => void;
  onSave?: () => Promise<void>;
  onDeleteTicket: (id: string) => void;
  onSpawnAgent: () => void;
  onCopyPrompt: () => void;
}

export function TicketEditToolbar({
  ticket,
  epics,
  pmDirty,
  copied,
  onUpdateTicket,
  onMoveTicket,
  onCancel,
  onSave,
  onDeleteTicket,
  onSpawnAgent,
  onCopyPrompt,
}: TicketEditToolbarProps) {
  return (
    <div
      data-testid="ticket-edit-toolbar"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3"
    >
      <input
        type="text"
        aria-label="Ticket name"
        value={ticket.name}
        onChange={(e) => onUpdateTicket(ticket.id, { name: e.target.value })}
        className="min-w-0 w-full basis-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
      />

      <div
        data-testid="ticket-edit-actions"
        className="ml-auto flex shrink-0 flex-wrap items-center gap-1"
      >
        <button
          type="button"
          onClick={onCancel}
          title="Deselect ticket"
          className="rounded-lg px-2 py-1.5 text-[10px] font-medium text-foreground-muted transition-colors hover:bg-white/5"
        >
          Deselect
        </button>
        <button
          type="button"
          disabled={!pmDirty}
          onClick={onSave}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-medium text-foreground transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-25"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onSpawnAgent}
          className="flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary-light transition hover:bg-primary/20"
        >
          <AuricIcon name="smart_toy" className="text-[16px]" />
          Start agent
        </button>
        <button
          type="button"
          onClick={onCopyPrompt}
          title="Copy prompt to clipboard"
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
            copied
              ? 'border-green-500/20 bg-green-500/10 text-green-400'
              : 'border-white/10 bg-white/5 text-foreground-muted hover:bg-white/10 hover:text-foreground'
          }`}
        >
          <AuricIcon name={copied ? 'check' : 'content_copy'} className="text-[16px]" />
          {copied ? 'Copied!' : 'Copy Prompt'}
        </button>
        <button
          type="button"
          aria-label="Delete ticket"
          onClick={() => onDeleteTicket(ticket.id)}
          className="rounded-lg p-1.5 text-foreground-muted opacity-50 transition-colors hover:bg-red-500/10 hover:text-red-400 hover:opacity-100"
        >
          <AuricIcon name="delete" className="text-[18px]" />
        </button>
      </div>

      <div
        data-testid="ticket-status-pills"
        className="flex w-full min-w-0 flex-wrap items-center gap-1"
      >
        {statusOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onUpdateTicket(ticket.id, { status: opt.value })}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              ticket.status === opt.value ? opt.className : 'text-foreground-muted hover:bg-white/5'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <select
          value={ticket.epicId}
          onChange={(e) => onMoveTicket(ticket.id, e.target.value)}
          aria-label="Move to epic"
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
        >
          {epics.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

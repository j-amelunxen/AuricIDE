import type { PmTicket } from '@/lib/tauri/pm';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import { InfoTooltip } from '../../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { TicketSkillsField } from '../TicketSkillsField';
import { TicketTiming } from '../TicketTiming';
import { formatDate, modelPowerOptions, priorityOptions } from './types';

interface TicketDetailsTabProps {
  ticket: PmTicket;
  discovered: ProjectSkill[];
  onUpdateTicket: (id: string, updates: Partial<PmTicket>) => void;
}

export function TicketDetailsTab({ ticket, discovered, onUpdateTicket }: TicketDetailsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-2 flex items-center text-xs text-foreground-muted">
          Priority
          <InfoTooltip description={GUIDANCE.pm.priority} label="i" />
        </label>
        <div className="flex gap-2" data-testid="priority-selector">
          {priorityOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onUpdateTicket(ticket.id, { priority: opt.value })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                ticket.priority === opt.value
                  ? opt.className
                  : 'border-transparent text-foreground-muted hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-xs text-foreground-muted" htmlFor="ticket-due-date">
          Due date
        </label>
        <input
          id="ticket-due-date"
          type="date"
          aria-label="Due date"
          value={ticket.dueDate ?? ''}
          onChange={(e) =>
            onUpdateTicket(ticket.id, {
              dueDate: e.target.value === '' ? null : e.target.value,
            })
          }
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-2 flex items-center text-xs text-foreground-muted">
          Agent strength
          <InfoTooltip description={GUIDANCE.pm.modelPower} label="i" />
        </label>
        <div className="flex gap-2" data-testid="model-power-selector">
          <button
            type="button"
            onClick={() => onUpdateTicket(ticket.id, { modelPower: undefined })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
              ticket.modelPower === undefined
                ? 'bg-white/10 text-foreground border-white/20'
                : 'border-transparent text-foreground-muted hover:bg-white/5'
            }`}
          >
            None
          </button>
          {modelPowerOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onUpdateTicket(ticket.id, { modelPower: opt.value })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                ticket.modelPower === opt.value
                  ? opt.className
                  : 'border-transparent text-foreground-muted hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-foreground-muted">Description</label>
        <textarea
          value={ticket.description}
          onChange={(e) => onUpdateTicket(ticket.id, { description: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none resize-none"
          rows={8}
        />
      </div>

      <TicketSkillsField
        skills={ticket.skills}
        discovered={discovered}
        onChange={(next) => onUpdateTicket(ticket.id, { skills: next })}
      />

      <div className="flex gap-4 text-xs text-foreground-muted">
        <span>Created: {formatDate(ticket.createdAt)}</span>
        <span>Updated: {formatDate(ticket.updatedAt)}</span>
      </div>

      <TicketTiming ticketId={ticket.id} status={ticket.status} />
    </div>
  );
}

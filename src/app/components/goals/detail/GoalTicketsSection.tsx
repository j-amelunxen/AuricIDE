'use client';

import { useState, useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { PmTicket } from '@/lib/tauri/pm';

export interface GoalTicketsSectionProps {
  goalId: string;
  goalTickets: PmTicket[];
  allTickets: PmTicket[];
  onLinkTicket: (goalId: string, ticketId: string) => void;
  onUnlinkTicket: (ticketId: string) => void;
  inputCls: string;
  labelCls: string;
}

export function GoalTicketsSection({
  goalId,
  goalTickets,
  allTickets,
  onLinkTicket,
  onUnlinkTicket,
  inputCls,
  labelCls,
}: GoalTicketsSectionProps) {
  const [ticketPickerOpen, setTicketPickerOpen] = useState(false);
  const [ticketQuery, setTicketQuery] = useState('');

  const linkableTickets = useMemo(() => {
    const query = ticketQuery.trim().toLowerCase();
    return allTickets.filter((t) => {
      if (t.goalId === goalId) return false;
      if (query && !t.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [goalId, allTickets, ticketQuery]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className={labelCls}>Tickets ({goalTickets.length})</label>
        <button
          data-testid="goal-ticket-add-btn"
          onClick={() => setTicketPickerOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-medium text-primary-light hover:bg-primary/10 transition-colors"
        >
          <AuricIcon name={ticketPickerOpen ? 'close' : 'add'} className="text-[12px]" />
          {ticketPickerOpen ? 'Close' : 'Add'}
        </button>
      </div>

      {goalTickets.length === 0 ? (
        <p className="text-[10px] text-foreground-muted/70">No tickets attached yet.</p>
      ) : (
        <ul className="space-y-1">
          {goalTickets.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-foreground/90"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  t.status === 'done'
                    ? 'bg-green-400'
                    : t.status === 'in_progress'
                      ? 'bg-amber-400'
                      : 'bg-gray-400'
                }`}
              />
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-[9px] text-foreground-muted">{t.status}</span>
              <button
                data-testid={`goal-ticket-unlink-${t.id}`}
                onClick={() => onUnlinkTicket(t.id)}
                className="text-[12px] text-foreground-muted opacity-60 hover:opacity-100 hover:text-red-300"
                title="Unlink"
              >
                <AuricIcon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {ticketPickerOpen && (
        <div
          data-testid="goal-ticket-picker"
          className="mt-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2"
        >
          <input
            data-testid="goal-ticket-picker-search"
            value={ticketQuery}
            onChange={(e) => setTicketQuery(e.target.value)}
            placeholder="Browse tickets by name…"
            autoFocus
            className={inputCls}
          />
          <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
            {linkableTickets.length === 0 ? (
              <li className="px-1 py-2 text-center text-[10px] text-foreground-muted/70">
                No matching tickets.
              </li>
            ) : (
              linkableTickets.map((t) => (
                <li
                  key={t.id}
                  data-testid={`goal-ticket-option-${t.id}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-foreground/90 hover:bg-white/5"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      t.status === 'done'
                        ? 'bg-green-400'
                        : t.status === 'in_progress'
                          ? 'bg-amber-400'
                          : 'bg-gray-400'
                    }`}
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                  {t.goalId && t.goalId !== goalId && (
                    <span className="shrink-0 text-[9px] text-amber-300/80">
                      already in another goal
                    </span>
                  )}
                  <button
                    data-testid={`goal-ticket-link-${t.id}`}
                    onClick={() => onLinkTicket(goalId, t.id)}
                    className="shrink-0 text-[14px] text-primary-light hover:text-primary"
                    title="Add to this goal"
                  >
                    <AuricIcon name="add_circle" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

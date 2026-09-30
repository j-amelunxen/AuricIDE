'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TICKET_USAGE_COLUMNS,
  TICKET_USAGE_COLUMN_LABEL,
  type TicketUsageColumn,
} from './ticketUsageColumns';

interface TicketColumnMenuProps {
  columns: readonly TicketUsageColumn[];
  onToggle: (column: TicketUsageColumn) => void;
}

/** A small menu that turns the optional usage columns on and off. */
export function TicketColumnMenu({ columns, onToggle }: TicketColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      if (event.type === 'pointerdown' && rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-foreground"
      >
        Columns
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Ticket columns"
          className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border border-white/10 bg-[#14141c] p-1 shadow-lg"
        >
          {TICKET_USAGE_COLUMNS.map((column) => {
            const checked = columns.includes(column);
            return (
              <button
                key={column}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => onToggle(column)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-foreground hover:bg-white/[0.06]"
              >
                <span className="w-3 text-primary-light">{checked ? '✓' : ''}</span>
                {TICKET_USAGE_COLUMN_LABEL[column]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

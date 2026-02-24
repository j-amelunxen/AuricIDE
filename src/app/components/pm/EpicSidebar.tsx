'use client';

import { useMemo } from 'react';
import type { PmEpic, PmTicket } from '@/lib/tauri/pm';

interface EpicSidebarProps {
  epics: PmEpic[];
  tickets: PmTicket[];
  selectedEpicId: string | null;
  onSelectEpic: (id: string | null) => void;
  onAddEpic: () => void;
  onEditEpic: (epic: PmEpic) => void;
  onDeleteEpic: (id: string) => void;
}

export function EpicSidebar({
  epics,
  tickets,
  selectedEpicId,
  onSelectEpic,
  onAddEpic,
  onEditEpic,
  onDeleteEpic,
}: EpicSidebarProps) {
  const ticketCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tickets) {
      map.set(t.epicId, (map.get(t.epicId) ?? 0) + 1);
    }
    return map;
  }, [tickets]);

  return (
    <div className="flex h-full flex-col border-r border-white/[0.08]">
      {/* Section header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-muted/50">
          Epics
        </span>
        <button
          type="button"
          aria-label="Add epic"
          onClick={onAddEpic}
          className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted/60 hover:bg-white/10 hover:text-foreground transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
        </button>
      </div>

      {/* Epic list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* "All" filter */}
        <button
          type="button"
          onClick={() => onSelectEpic(null)}
          className={`flex w-full items-center justify-between pl-3 pr-3 py-2 text-xs transition-colors border-l-2 ${
            selectedEpicId === null
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-transparent text-foreground-muted hover:bg-white/[0.04] hover:text-foreground'
          }`}
        >
          <span className="font-medium">All</span>
          <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] tabular-nums text-foreground-muted">
            {tickets.length}
          </span>
        </button>

        {epics.length > 0 && <div className="mx-3.5 my-1 h-px bg-white/[0.05]" />}

        {/* Individual epics */}
        {epics.map((epic) => (
          <div
            key={epic.id}
            data-testid={`epic-item-${epic.id}`}
            className={`group flex items-center pl-3 pr-2 transition-colors border-l-2 ${
              selectedEpicId === epic.id
                ? 'border-primary/50 bg-primary/10'
                : 'border-transparent hover:bg-white/[0.04]'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectEpic(epic.id)}
              className="flex-1 min-w-0 py-2 text-left text-xs text-foreground truncate"
              title={epic.name}
            >
              {epic.name}
            </button>

            <div className="flex items-center gap-0.5 shrink-0 ml-1">
              <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] tabular-nums text-foreground-muted">
                {ticketCounts.get(epic.id) ?? 0}
              </span>

              <button
                type="button"
                aria-label={`Edit epic ${epic.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditEpic(epic);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-white/10 hover:text-foreground transition-all"
              >
                <span className="material-symbols-outlined text-[13px]">edit</span>
              </button>

              <button
                type="button"
                aria-label={`Delete epic ${epic.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEpic(epic.id);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo, useCallback, type MouseEvent } from 'react';
import type { PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';
import { useStore } from '@/lib/store';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import { calculateHeat, getHeatStyles } from '@/lib/pm/heat';

interface TicketTableProps {
  tickets: PmTicket[];
  allTickets: PmTicket[];
  testCases?: PmTestCase[];
  selectedTicketId: string | null;
  dependencies: PmDependency[];
  onSelectTicket: (id: string) => void;
  onUpdateTicket: (id: string, updates: Partial<PmTicket>) => void;
  onSave?: () => Promise<void>;
  onAddTicket: () => void;
}

type SortKey = 'name' | 'status' | 'priority' | 'createdAt';

const statusLabel: Record<PmTicket['status'], string> = {
  open: 'Open',
  in_progress: 'IP',
  done: 'Done',
  archived: 'Archived',
};

const statusBadge: Record<PmTicket['status'], string> = {
  open: 'bg-white/10 text-foreground-muted',
  in_progress: 'bg-yellow-500/10 text-git-modified',
  done: 'bg-green-500/10 text-git-added',
  archived: 'bg-purple-500/10 text-purple-400',
};

const statusDot: Record<PmTicket['status'], string> = {
  open: 'bg-white/25',
  in_progress: 'bg-yellow-400/60',
  done: 'bg-green-400/60',
  archived: 'bg-purple-400/60',
};

const priorityLabel: Record<PmTicket['priority'], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

const priorityIcon: Record<PmTicket['priority'], string> = {
  low: 'keyboard_double_arrow_down',
  normal: 'remove',
  high: 'keyboard_double_arrow_up',
  critical: 'priority_high',
};

const priorityValue: Record<PmTicket['priority'], number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

const modelPowerBadge: Record<NonNullable<PmTicket['modelPower']>, string> = {
  low: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  medium: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
  high: 'bg-red-500/15 text-red-300 border-red-500/20',
};

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'createdAt', label: 'Created' },
];

export function TicketTable({
  tickets,
  allTickets,
  testCases = [],
  selectedTicketId,
  dependencies,
  onSelectTicket,
  onUpdateTicket,
  onSave,
  onAddTicket,
}: TicketTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortAsc, setSortAsc] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ticket: PmTicket } | null>(
    null
  );
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);

  const isBlocked = (ticketId: string) => {
    return dependencies.some((dep) => {
      if (dep.sourceId !== ticketId || dep.targetType !== 'ticket') return false;
      const target = allTickets.find((t) => t.id === dep.targetId);
      if (!target) return false;
      return target.status !== 'done' && target.status !== 'archived';
    });
  };

  const handleContextMenu = (e: React.MouseEvent, ticket: PmTicket) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, ticket });
  };

  const handleSpawnAgent = useCallback(
    async (ticket: PmTicket, e: MouseEvent) => {
      e.stopPropagation();
      let task = `Implementation of ticket: ${ticket.name}\n\n`;
      task += `Description:\n${ticket.description}\n\n`;
      const ticketTCs = testCases.filter((tc) => tc.ticketId === ticket.id);
      if (ticketTCs.length > 0) {
        task += `Test Cases:\n`;
        ticketTCs.forEach((tc, idx) => {
          task += `${idx + 1}. ${tc.title}\n${tc.body}\n\n`;
        });
      }

      onUpdateTicket(ticket.id, { status: 'in_progress' });
      if (onSave) {
        await onSave();
      }
      setInitialAgentTask(task.trim());
      setSpawnAgentTicketId(ticket.id);
      setSpawnDialogOpen(true);
    },
    [
      testCases,
      onUpdateTicket,
      onSave,
      setInitialAgentTask,
      setSpawnAgentTicketId,
      setSpawnDialogOpen,
    ]
  );

  const contextMenuOptions = useMemo<ContextMenuOption[]>(() => {
    if (!contextMenu) return [];
    const { ticket } = contextMenu;

    const options: ContextMenuOption[] = [];

    // Status Section
    options.push({ type: 'header', label: 'Status' });

    if (ticket.status === 'open') {
      options.push({
        label: 'Start Work',
        icon: 'play_arrow',
        action: () => onUpdateTicket(ticket.id, { status: 'in_progress' }),
      });
    } else if (ticket.status === 'in_progress') {
      options.push({
        label: 'Mark as Done',
        icon: 'check_circle',
        action: () => onUpdateTicket(ticket.id, { status: 'done' }),
      });
    } else if (ticket.status === 'done' || ticket.status === 'archived') {
      options.push({
        label: 'Reopen',
        icon: 'history',
        action: () => onUpdateTicket(ticket.id, { status: 'open' }),
      });
    }

    if (ticket.status !== 'archived') {
      options.push({
        label: 'Archive',
        icon: 'archive',
        action: () => onUpdateTicket(ticket.id, { status: 'archived' }),
      });
    }

    options.push({ type: 'separator' });

    // Priority Section
    options.push({ type: 'header', label: 'Priority' });
    (['low', 'normal', 'high', 'critical'] as const).forEach((p) => {
      options.push({
        label: priorityLabel[p],
        icon: priorityIcon[p],
        action: () => onUpdateTicket(ticket.id, { priority: p }),
        // Highlight current
        ...(ticket.priority === p ? { icon: 'check' } : {}),
      });
    });

    options.push({ type: 'separator' });

    // Model Power Section
    options.push({ type: 'header', label: 'Model Power' });
    options.push({
      label: 'None',
      icon: ticket.modelPower === undefined ? 'check' : undefined,
      action: () => onUpdateTicket(ticket.id, { modelPower: undefined }),
    });
    (['low', 'medium', 'high'] as const).forEach((mp) => {
      options.push({
        label: mp.charAt(0).toUpperCase() + mp.slice(1),
        icon: ticket.modelPower === mp ? 'check' : undefined,
        action: () => onUpdateTicket(ticket.id, { modelPower: mp }),
      });
    });

    options.push({ type: 'separator' });

    options.push({
      label: ticket.needsHumanSupervision ? 'Remove Supervision' : 'Require Supervision',
      icon: ticket.needsHumanSupervision ? 'visibility_off' : 'visibility',
      action: () =>
        onUpdateTicket(ticket.id, { needsHumanSupervision: !ticket.needsHumanSupervision }),
    });

    options.push({ type: 'separator' });

    options.push({
      label: 'Spawn Agent',
      icon: 'smart_toy',
      action: () => {
        handleSpawnAgent(ticket, { stopPropagation: () => {} } as React.MouseEvent);
      },
    });

    return options;
  }, [contextMenu, onUpdateTicket, handleSpawnAgent]);

  const sorted = useMemo(() => {
    const arr = [...tickets];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'priority':
          cmp = priorityValue[a.priority] - priorityValue[b.priority];
          break;
        case 'createdAt':
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [tickets, sortKey, sortAsc]);

  const handleSortChange = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-muted/50">
          Tickets
        </span>
        <select
          value={sortKey}
          onChange={(e) => handleSortChange(e.target.value as SortKey)}
          aria-label="Sort tickets"
          className="bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-foreground-muted focus:outline-none cursor-pointer"
        >
          {sortOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label} {sortKey === opt.key ? (sortAsc ? '\u2191' : '\u2193') : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-10 gap-2">
            <span className="material-symbols-outlined text-[28px] text-foreground-muted/20">
              inbox
            </span>
            <p className="text-xs text-foreground-muted/50">No tickets</p>
          </div>
        )}

        {sorted.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTicket(ticket.id)}
            onContextMenu={(e) => handleContextMenu(e, ticket)}
            className={`group relative flex items-center gap-2 cursor-pointer px-3 py-2.5 border-b border-white/[0.05] transition-colors hover:bg-white/[0.04] ${
              selectedTicketId === ticket.id ? 'bg-primary/10' : ''
            }`}
          >
            {isBlocked(ticket.id) && (
              <div
                className="absolute left-0 top-[4px] bottom-[4px] w-[2px] bg-git-deleted/80 rounded-full"
                title="Blocked by dependencies"
              />
            )}
            {/* Status dot — purely visual */}
            <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${statusDot[ticket.status]}`} />

            {/* Priority icon */}
            <span
              className="material-symbols-outlined text-[14px] text-foreground-muted/40 select-none"
              title={`Priority: ${priorityLabel[ticket.priority]}`}
            >
              {priorityIcon[ticket.priority]}
            </span>

            {/* Name — direct child of row div so closest('div[class]') finds the row */}
            <span className="flex-1 text-xs text-foreground truncate" title={ticket.name}>
              {ticket.name}
            </span>

            {/* Human Supervision Indicator */}
            {ticket.needsHumanSupervision && (
              <span
                className="material-symbols-outlined shrink-0 text-[14px] text-orange-300/60"
                title="Needs human supervision"
              >
                visibility
              </span>
            )}

            {/* Model Power Badge */}
            {ticket.modelPower && (
              <span
                className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                  modelPowerBadge[ticket.modelPower]
                }`}
                title={`Model Power: ${ticket.modelPower}`}
              >
                {ticket.modelPower.charAt(0)}
              </span>
            )}

            {/* Heat Badge */}
            {(() => {
              const heat = calculateHeat(ticket.id, dependencies);
              if (heat === 0) return null;
              return (
                <span
                  className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-bold flex items-center gap-0.5 border ${getHeatStyles(
                    heat
                  )}`}
                  title={`${heat} items depend on this ticket`}
                >
                  <span className="material-symbols-outlined text-[10px]">
                    local_fire_department
                  </span>
                  {heat}
                </span>
              );
            })()}

            {/* Actions + badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => handleSpawnAgent(ticket, e)}
                title="Spawn Agent"
                className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-primary/20 text-primary-light transition-all"
              >
                <span className="material-symbols-outlined text-[14px]">smart_toy</span>
              </button>
              <span
                className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusBadge[ticket.status]}`}
              >
                {statusLabel[ticket.status]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-white/[0.08] p-2">
        <button
          type="button"
          onClick={onAddTicket}
          className="w-full rounded-lg py-2 text-xs font-medium text-foreground-muted hover:bg-primary/10 hover:text-primary-light transition-colors"
        >
          + New Ticket
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenuOptions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

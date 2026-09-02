'use client';

import { useState, useMemo, useCallback, type MouseEvent } from 'react';
import type { PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';
import { useStore } from '@/lib/store';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import {
  priorityLabel,
  priorityIcon,
  buildTicketStatusPriorityPowerOptions,
} from './ticketContextMenu';
import { calculateHeat, getHeatStyles } from '@/lib/pm/heat';
import {
  TICKET_STATUS_BADGE_CLASS,
  TICKET_STATUS_DOT_CLASS,
  TICKET_STATUS_LABEL,
} from '@/lib/pm/ticketStatusStyle';
import { isClosedTicketStatus } from '@/lib/pm/enums';
import { prependTicketSkills } from '@/lib/pm/ticketSkills';
import {
  TICKET_SORTS,
  TICKET_SORT_LABEL,
  parseTicketSort,
  sortTickets,
  type TicketSort,
} from '@/lib/pm/sortTickets';
import { useListDragReorder } from '@/lib/pm/useListDragReorder';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { AuricIcon } from '../ui/AuricIcon';

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
  /** Custom order of the currently visible tickets. */
  onReorderTickets?: (orderedIds: string[]) => void;
  /** True while project data is being read — an empty list is not yet a fact. */
  loading?: boolean;
  /** Why the tickets could not be read; shown instead of a false empty state. */
  loadError?: string | null;
}

const modelPowerBadge: Record<NonNullable<PmTicket['modelPower']>, string> = {
  low: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  medium: 'bg-orange-500/15 text-orange-300 border-orange-500/20',
  high: 'bg-red-500/15 text-red-300 border-red-500/20',
};

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
  onReorderTickets,
  loading = false,
  loadError = null,
}: TicketTableProps) {
  const [sortKey, setSortKey] = useState<TicketSort>(() =>
    parseTicketSort(readAppPref(APP_CONFIG_KEYS.pmTicketSort))
  );
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
      return !isClosedTicketStatus(target.status);
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
      setInitialAgentTask(prependTicketSkills(ticket.skills, task.trim()));
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

    const options = buildTicketStatusPriorityPowerOptions(ticket, onUpdateTicket);

    options.push({ type: 'separator' });

    options.push({
      label: ticket.needsHumanSupervision ? 'Remove Supervision' : 'Require Supervision',
      icon: ticket.needsHumanSupervision ? 'visibility_off' : 'visibility',
      action: () =>
        onUpdateTicket(ticket.id, { needsHumanSupervision: !ticket.needsHumanSupervision }),
    });

    options.push({ type: 'separator' });

    options.push({
      label: 'Start agent',
      icon: 'smart_toy',
      action: () => {
        handleSpawnAgent(ticket, { stopPropagation: () => {} } as React.MouseEvent);
      },
    });

    return options;
  }, [contextMenu, onUpdateTicket, handleSpawnAgent]);

  const sorted = useMemo(() => sortTickets(tickets, sortKey, sortAsc), [tickets, sortKey, sortAsc]);
  const sortedIds = useMemo(() => sorted.map((ticket) => ticket.id), [sorted]);
  const { draggedId, dropTarget, canReorder, onDragStart, onDragOver, onDrop, onDragEnd } =
    useListDragReorder(sortedIds, onReorderTickets, sortKey === 'custom' && sortAsc);

  const handleSortChange = (key: TicketSort) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
    writeAppPref(APP_CONFIG_KEYS.pmTicketSort, key);
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
          onChange={(e) => handleSortChange(parseTicketSort(e.target.value))}
          aria-label="Sort tickets"
          className="bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 text-[10px] text-foreground-muted focus:outline-none cursor-pointer"
        >
          {TICKET_SORTS.map((key) => (
            <option key={key} value={key}>
              {TICKET_SORT_LABEL[key]} {sortKey === key ? (sortAsc ? '\u2191' : '\u2193') : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 && loadError && (
          <div
            data-testid="ticket-table-error"
            className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
          >
            <AuricIcon name="error" className="text-[28px] text-red-400/60" />
            <p className="text-xs text-foreground">Tickets could not be read</p>
            <p className="max-w-[260px] text-[10px] text-foreground-muted">{loadError}</p>
          </div>
        )}

        {sorted.length === 0 && !loadError && loading && (
          <div
            data-testid="ticket-table-loading"
            className="flex flex-col items-center justify-center px-4 py-10"
          >
            <p className="text-xs text-foreground-muted">Loading tickets…</p>
          </div>
        )}

        {sorted.length === 0 && !loadError && !loading && (
          <div className="flex flex-col items-center justify-center px-4 py-10 gap-2">
            <AuricIcon name="inbox" className="text-[28px] text-foreground-muted/20" />
            <p className="text-xs text-foreground-muted/50">No tickets</p>
          </div>
        )}

        {sorted.map((ticket) => (
          <div
            key={ticket.id}
            data-testid={`ticket-row-${ticket.id}`}
            draggable={canReorder}
            onDragStart={(event) => onDragStart(ticket.id, event)}
            onDragOver={(event) => onDragOver(ticket.id, event)}
            onDrop={(event) => onDrop(ticket.id, event)}
            onDragEnd={onDragEnd}
            onClick={() => onSelectTicket(ticket.id)}
            onContextMenu={(e) => handleContextMenu(e, ticket)}
            title={canReorder ? 'Drag to reorder' : undefined}
            className={`group relative flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.05] transition-colors hover:bg-white/[0.04] ${
              canReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
            } ${draggedId === ticket.id ? 'opacity-35' : ''} ${
              selectedTicketId === ticket.id ? 'bg-primary/10' : ''
            }`}
          >
            {dropTarget?.id === ticket.id && dropTarget.place === 'before' && (
              <span
                data-testid={`ticket-drop-before-${ticket.id}`}
                className="pointer-events-none absolute left-3 right-3 top-0 z-10 h-0.5 rounded-full bg-primary"
              />
            )}
            {dropTarget?.id === ticket.id && dropTarget.place === 'after' && (
              <span
                data-testid={`ticket-drop-after-${ticket.id}`}
                className="pointer-events-none absolute bottom-0 left-3 right-3 z-10 h-0.5 rounded-full bg-primary"
              />
            )}
            {isBlocked(ticket.id) && (
              <div
                className="absolute left-0 top-[4px] bottom-[4px] w-[2px] bg-git-deleted/80 rounded-full"
                title="Blocked by dependencies"
              />
            )}
            {/* Status dot — purely visual */}
            <span
              className={`shrink-0 h-1.5 w-1.5 rounded-full ${TICKET_STATUS_DOT_CLASS[ticket.status]}`}
            />

            {/* Priority icon */}
            <AuricIcon
              name={priorityIcon[ticket.priority]}
              className="text-[14px] text-foreground-muted/40 select-none"
              title={`Priority: ${priorityLabel[ticket.priority]}`}
            />

            {/* Name — direct child of row div so closest('div[class]') finds the row */}
            <span className="flex-1 text-xs text-foreground truncate" title={ticket.name}>
              {ticket.name}
            </span>

            {/* Human Supervision Indicator */}
            {ticket.needsHumanSupervision && (
              <AuricIcon
                name="visibility"
                className="shrink-0 text-[14px] text-orange-300/60"
                title="Needs human supervision"
              />
            )}

            {/* Agent strength Badge */}
            {ticket.modelPower && (
              <span
                className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
                  modelPowerBadge[ticket.modelPower]
                }`}
                title={`Agent strength: ${ticket.modelPower}`}
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
                  <AuricIcon name="local_fire_department" className="text-[10px]" />
                  {heat}
                </span>
              );
            })()}

            {/* Actions + badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => handleSpawnAgent(ticket, e)}
                title="Start agent"
                className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-primary/20 text-primary-light transition"
              >
                <AuricIcon name="smart_toy" className="text-[14px]" />
              </button>
              <span
                className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium ${TICKET_STATUS_BADGE_CLASS[ticket.status]}`}
              >
                {TICKET_STATUS_LABEL[ticket.status]}
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

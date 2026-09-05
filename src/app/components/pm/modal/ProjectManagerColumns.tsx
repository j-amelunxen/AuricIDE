'use client';

import { EpicSidebar } from '../EpicSidebar';
import { TicketTable } from '../TicketTable';
import { TicketEditPanel } from '../TicketEditPanel';
import type { PmEpic, PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';

export interface ProjectManagerColumnsProps {
  draftEpics: PmEpic[];
  draftTickets: PmTicket[];
  filteredTickets: PmTicket[];
  draftTestCases: PmTestCase[];
  draftDependencies: PmDependency[];
  selectedEpicId: string | null;
  selectedTicket: PmTicket | null;
  selectedTicketId: string | null;
  ticketTestCases: PmTestCase[];
  ticketDependencies: PmDependency[];
  availableItems: { id: string; type: 'epic' | 'ticket'; name: string; status?: string }[];
  pmLoading: boolean;
  pmLoadError: string | null;
  onSelectEpic: (id: string | null) => void;
  onAddEpic: () => void;
  onEditEpic: (epic: PmEpic) => void;
  onDeleteEpic: (id: string) => void;
  onReorderEpics: (orderedIds: string[]) => void;
  onSelectTicket: (id: string | null) => void;
  onUpdateTicket: (id: string, patch: Partial<PmTicket>) => void;
  onSave: () => Promise<void>;
  onOpenCreateTicket: () => void;
  onReorderTickets: (orderedIds: string[]) => void;
  onDeleteTicket: (id: string) => void;
  onMoveTicket: (ticketId: string, newEpicId: string) => void;
  onAddTestCase: (initial?: Partial<PmTestCase>) => void;
  onUpdateTestCase: (id: string, patch: Partial<PmTestCase>) => void;
  onDeleteTestCase: (id: string) => void;
  onAddDependency: (dependency: PmDependency) => void;
  onRemoveDependency: (id: string) => void;
}

export function ProjectManagerColumns({
  draftEpics,
  draftTickets,
  filteredTickets,
  draftTestCases,
  draftDependencies,
  selectedEpicId,
  selectedTicket,
  selectedTicketId,
  ticketTestCases,
  ticketDependencies,
  availableItems,
  pmLoading,
  pmLoadError,
  onSelectEpic,
  onAddEpic,
  onEditEpic,
  onDeleteEpic,
  onReorderEpics,
  onSelectTicket,
  onUpdateTicket,
  onSave,
  onOpenCreateTicket,
  onReorderTickets,
  onDeleteTicket,
  onMoveTicket,
  onAddTestCase,
  onUpdateTestCase,
  onDeleteTestCase,
  onAddDependency,
  onRemoveDependency,
}: ProjectManagerColumnsProps) {
  return (
    <div
      data-testid="tickets-columns"
      className="@container flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div data-testid="tickets-epics-col" className="w-40 min-w-0 shrink-0 @4xl:w-[220px]">
        <EpicSidebar
          epics={draftEpics}
          tickets={draftTickets}
          selectedEpicId={selectedEpicId}
          onSelectEpic={onSelectEpic}
          onAddEpic={onAddEpic}
          onEditEpic={onEditEpic}
          onDeleteEpic={onDeleteEpic}
          onReorderEpics={onReorderEpics}
        />
      </div>

      <div
        data-testid="tickets-list-col"
        className="w-52 min-w-0 shrink-0 border-l border-r border-white/[0.08] @4xl:w-[280px]"
      >
        <TicketTable
          loading={pmLoading}
          loadError={pmLoadError}
          tickets={filteredTickets}
          allTickets={draftTickets}
          testCases={draftTestCases}
          selectedTicketId={selectedTicketId}
          dependencies={draftDependencies}
          onSelectTicket={onSelectTicket}
          onUpdateTicket={onUpdateTicket}
          onSave={onSave}
          onAddTicket={onOpenCreateTicket}
          onReorderTickets={onReorderTickets}
        />
      </div>

      <div data-testid="tickets-detail-col" className="min-w-0 flex-1">
        <TicketEditPanel
          ticket={selectedTicket}
          epics={draftEpics}
          allTickets={draftTickets}
          testCases={ticketTestCases}
          dependencies={ticketDependencies}
          availableItems={availableItems}
          onUpdateTicket={onUpdateTicket}
          onSave={onSave}
          onCancel={() => onSelectTicket(null)}
          onDeleteTicket={onDeleteTicket}
          onMoveTicket={onMoveTicket}
          onAddTestCase={onAddTestCase}
          onUpdateTestCase={onUpdateTestCase}
          onDeleteTestCase={onDeleteTestCase}
          onAddDependency={onAddDependency}
          onRemoveDependency={onRemoveDependency}
        />
      </div>
    </div>
  );
}

import type { PmDependency, PmEpic, PmTestCase, PmTicket } from '../../tauri/pm';
import { applyVisibleOrder } from '../../pm/customOrder';

/**
 * The persisted PM snapshot and its independently editable draft. UI-only
 * fields intentionally stay in pmSlice; they are not domain state.
 */
export interface PmDomainState {
  pmEpics: PmEpic[];
  pmTickets: PmTicket[];
  pmTestCases: PmTestCase[];
  pmDependencies: PmDependency[];
  pmDraftEpics: PmEpic[];
  pmDraftTickets: PmTicket[];
  pmDraftTestCases: PmTestCase[];
  pmDraftDependencies: PmDependency[];
  pmDirty: boolean;
}

export type PmDomainEvent =
  | { type: 'deleteEpic'; id: string }
  | { type: 'deleteTicket'; id: string }
  | { type: 'reorderTickets'; visibleOrderedIds: string[] }
  | { type: 'reorderEpics'; orderedIds: string[] }
  | { type: 'discardChanges' }
  | { type: 'updateTicket'; id: string; updates: Partial<PmTicket>; now: string };

/**
 * Reserved for domain-triggered work at an outer boundary. The pilot has no
 * such work: every transition is synchronous and pure, so effects is empty.
 */
export type PmDomainEffect = { type: 'persistPmDraft' };

export interface PmDomainTransition {
  state: PmDomainState;
  effects: readonly PmDomainEffect[];
}

const NO_EFFECTS: readonly PmDomainEffect[] = [];

function unchanged(state: PmDomainState): PmDomainTransition {
  return { state, effects: NO_EFFECTS };
}

function changed(state: PmDomainState, updates: Partial<PmDomainState>): PmDomainTransition {
  return { state: { ...state, ...updates, pmDirty: true }, effects: NO_EFFECTS };
}

function isSameTicket(left: PmTicket, right: PmTicket): boolean {
  return Object.keys(left).every(
    (key) => left[key as keyof PmTicket] === right[key as keyof PmTicket]
  );
}

/**
 * Applies one draft-domain event without I/O or time access. A transition that
 * cannot change the draft returns the original state object and no effects.
 */
export function transitionPmDomain(state: PmDomainState, event: PmDomainEvent): PmDomainTransition {
  switch (event.type) {
    case 'deleteEpic': {
      if (!state.pmDraftEpics.some((epic) => epic.id === event.id)) return unchanged(state);

      const ticketIds = new Set(
        state.pmDraftTickets
          .filter((ticket) => ticket.epicId === event.id)
          .map((ticket) => ticket.id)
      );
      return changed(state, {
        pmDraftEpics: state.pmDraftEpics.filter((epic) => epic.id !== event.id),
        pmDraftTickets: state.pmDraftTickets.filter((ticket) => ticket.epicId !== event.id),
        pmDraftTestCases: state.pmDraftTestCases.filter(
          (testCase) => !ticketIds.has(testCase.ticketId)
        ),
      });
    }

    case 'deleteTicket': {
      if (!state.pmDraftTickets.some((ticket) => ticket.id === event.id)) return unchanged(state);

      return changed(state, {
        pmDraftTickets: state.pmDraftTickets.filter((ticket) => ticket.id !== event.id),
        pmDraftTestCases: state.pmDraftTestCases.filter(
          (testCase) => testCase.ticketId !== event.id
        ),
      });
    }

    case 'reorderTickets': {
      const pmDraftTickets = applyVisibleOrder(state.pmDraftTickets, event.visibleOrderedIds);
      return pmDraftTickets === state.pmDraftTickets
        ? unchanged(state)
        : changed(state, { pmDraftTickets });
    }

    case 'reorderEpics': {
      const pmDraftEpics = applyVisibleOrder(state.pmDraftEpics, event.orderedIds);
      return pmDraftEpics === state.pmDraftEpics
        ? unchanged(state)
        : changed(state, { pmDraftEpics });
    }

    case 'discardChanges':
      return {
        state: {
          ...state,
          pmDraftEpics: state.pmEpics,
          pmDraftTickets: state.pmTickets,
          pmDraftTestCases: state.pmTestCases,
          pmDraftDependencies: state.pmDependencies,
          pmDirty: false,
        },
        effects: NO_EFFECTS,
      };

    case 'updateTicket': {
      const ticketIndex = state.pmDraftTickets.findIndex((ticket) => ticket.id === event.id);
      if (ticketIndex === -1) return unchanged(state);

      const ticket = state.pmDraftTickets[ticketIndex];
      const statusChanged =
        event.updates.status !== undefined && event.updates.status !== ticket.status;
      const nextTicket: PmTicket = {
        ...ticket,
        ...event.updates,
        statusUpdatedAt: statusChanged ? event.now : ticket.statusUpdatedAt,
      };
      if (isSameTicket(ticket, nextTicket)) return unchanged(state);

      const pmDraftTickets = state.pmDraftTickets.slice();
      pmDraftTickets[ticketIndex] = nextTicket;
      return changed(state, { pmDraftTickets });
    }
  }
}

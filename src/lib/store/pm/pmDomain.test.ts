import { describe, expect, it } from 'vitest';
import type { PmDependency, PmEpic, PmTestCase, PmTicket } from '../../tauri/pm';
import { transitionPmDomain, type PmDomainState } from './pmDomain';

function makeEpic(overrides: Partial<PmEpic> = {}): PmEpic {
  return {
    id: 'e1',
    name: 'Epic 1',
    description: '',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Ticket 1',
    description: '',
    status: 'open',
    statusUpdatedAt: '',
    priority: 'normal',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeTestCase(overrides: Partial<PmTestCase> = {}): PmTestCase {
  return {
    id: 'tc1',
    ticketId: 't1',
    title: 'Test Case 1',
    body: '',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeDependency(overrides: Partial<PmDependency> = {}): PmDependency {
  return {
    id: 'd1',
    sourceType: 'ticket',
    sourceId: 't1',
    targetType: 'ticket',
    targetId: 't2',
    ...overrides,
  };
}

function makeState(overrides: Partial<PmDomainState> = {}): PmDomainState {
  return {
    pmEpics: [],
    pmTickets: [],
    pmTestCases: [],
    pmDependencies: [],
    pmDraftEpics: [],
    pmDraftTickets: [],
    pmDraftTestCases: [],
    pmDraftDependencies: [],
    pmDirty: false,
    ...overrides,
  };
}

describe('transitionPmDomain', () => {
  it('deletes an epic and cascades only its tickets and test cases without I/O effects', () => {
    const state = makeState({
      pmDraftEpics: [makeEpic({ id: 'e1' }), makeEpic({ id: 'e2', name: 'Other epic' })],
      pmDraftTickets: [
        makeTicket({ id: 't1', epicId: 'e1' }),
        makeTicket({ id: 't2', epicId: 'e2' }),
      ],
      pmDraftTestCases: [
        makeTestCase({ id: 'tc1', ticketId: 't1' }),
        makeTestCase({ id: 'tc2', ticketId: 't2' }),
      ],
      pmDraftDependencies: [makeDependency()],
    });

    const result = transitionPmDomain(state, { type: 'deleteEpic', id: 'e1' });

    expect(result.state.pmDraftEpics.map((epic) => epic.id)).toEqual(['e2']);
    expect(result.state.pmDraftTickets.map((ticket) => ticket.id)).toEqual(['t2']);
    expect(result.state.pmDraftTestCases.map((testCase) => testCase.id)).toEqual(['tc2']);
    expect(result.state.pmDraftDependencies).toEqual(state.pmDraftDependencies);
    expect(result.state.pmDirty).toBe(true);
    expect(result.effects).toEqual([]);
  });

  it('deletes a ticket and cascades its test cases', () => {
    const state = makeState({
      pmDraftTickets: [makeTicket({ id: 't1' }), makeTicket({ id: 't2' })],
      pmDraftTestCases: [
        makeTestCase({ id: 'tc1', ticketId: 't1' }),
        makeTestCase({ id: 'tc2', ticketId: 't2' }),
      ],
    });

    const result = transitionPmDomain(state, { type: 'deleteTicket', id: 't1' });

    expect(result.state.pmDraftTickets.map((ticket) => ticket.id)).toEqual(['t2']);
    expect(result.state.pmDraftTestCases.map((testCase) => testCase.id)).toEqual(['tc2']);
    expect(result.state.pmDirty).toBe(true);
    expect(result.effects).toEqual([]);
  });

  it('keeps state and clean status for a missing deletion', () => {
    const state = makeState({ pmDraftTickets: [makeTicket()], pmDirty: false });

    const result = transitionPmDomain(state, { type: 'deleteTicket', id: 'missing' });

    expect(result.state).toBe(state);
    expect(result.effects).toEqual([]);
  });

  it('reorders visible tickets without collapsing other epic slots and ignores invalid orders', () => {
    const state = makeState({
      pmDraftTickets: [
        makeTicket({ id: 'a1', epicId: 'e1', sortOrder: 0 }),
        makeTicket({ id: 'b1', epicId: 'e2', sortOrder: 1 }),
        makeTicket({ id: 'a2', epicId: 'e1', sortOrder: 2 }),
      ],
    });

    const reordered = transitionPmDomain(state, {
      type: 'reorderTickets',
      visibleOrderedIds: ['a2', 'a1'],
    });
    const invalid = transitionPmDomain(state, {
      type: 'reorderTickets',
      visibleOrderedIds: ['a1', 'missing'],
    });

    expect(
      Object.fromEntries(
        reordered.state.pmDraftTickets.map((ticket) => [ticket.id, ticket.sortOrder])
      )
    ).toEqual({ a2: 0, b1: 1, a1: 2 });
    expect(reordered.state.pmDirty).toBe(true);
    expect(reordered.effects).toEqual([]);
    expect(invalid.state).toBe(state);
    expect(invalid.effects).toEqual([]);
  });

  it('reorders epics, discards draft edits back to persisted data, and never changes persisted data', () => {
    const persistedEpic = makeEpic({ id: 'e1', name: 'Persisted', sortOrder: 0 });
    const persistedTicket = makeTicket({ id: 't1', name: 'Persisted ticket' });
    const state = makeState({
      pmEpics: [persistedEpic, makeEpic({ id: 'e2', name: 'Persisted 2', sortOrder: 1 })],
      pmTickets: [persistedTicket],
      pmTestCases: [makeTestCase()],
      pmDependencies: [makeDependency()],
      pmDraftEpics: [
        makeEpic({ id: 'e1', name: 'Draft 1', sortOrder: 0 }),
        makeEpic({ id: 'e2', name: 'Draft 2', sortOrder: 1 }),
      ],
      pmDraftTickets: [makeTicket({ id: 't1', name: 'Draft ticket' })],
      pmDraftTestCases: [],
      pmDraftDependencies: [],
      pmDirty: true,
    });

    const reordered = transitionPmDomain(state, {
      type: 'reorderEpics',
      orderedIds: ['e2', 'e1'],
    });
    const discarded = transitionPmDomain(state, { type: 'discardChanges' });

    expect(
      Object.fromEntries(reordered.state.pmDraftEpics.map((epic) => [epic.id, epic.sortOrder]))
    ).toEqual({ e1: 1, e2: 0 });
    expect(reordered.state.pmEpics).toBe(state.pmEpics);
    expect(discarded.state.pmDraftEpics).toBe(state.pmEpics);
    expect(discarded.state.pmDraftTickets).toBe(state.pmTickets);
    expect(discarded.state.pmDraftTestCases).toBe(state.pmTestCases);
    expect(discarded.state.pmDraftDependencies).toBe(state.pmDependencies);
    expect(discarded.state.pmDirty).toBe(false);
    expect(discarded.effects).toEqual([]);
  });

  it('updates a ticket with the caller-provided timestamp only when its status changes', () => {
    const state = makeState({
      pmDraftTickets: [makeTicket({ id: 't1', status: 'open', statusUpdatedAt: 'before' })],
    });

    const changed = transitionPmDomain(state, {
      type: 'updateTicket',
      id: 't1',
      updates: { status: 'in_progress' },
      now: '2026-09-24T10:00:00.000Z',
    });
    const unchanged = transitionPmDomain(state, {
      type: 'updateTicket',
      id: 't1',
      updates: { status: 'open' },
      now: '2026-09-24T10:00:00.000Z',
    });

    expect(changed.state.pmDraftTickets[0]).toMatchObject({
      status: 'in_progress',
      statusUpdatedAt: '2026-09-24T10:00:00.000Z',
    });
    expect(changed.state.pmDirty).toBe(true);
    expect(changed.effects).toEqual([]);
    expect(unchanged.state).toBe(state);
    expect(unchanged.effects).toEqual([]);
  });
});

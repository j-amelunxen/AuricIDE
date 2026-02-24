import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createPmSlice, type PmSlice } from './pmSlice';
import type { PmEpic, PmTicket, PmTestCase, PmDependency } from '../tauri/pm';

const mockPmLoad = vi.fn(() =>
  Promise.resolve({ epics: [], tickets: [], testCases: [], dependencies: [] })
);
const mockPmSave = vi.fn(() => Promise.resolve());
const mockPmClear = vi.fn(() => Promise.resolve());
const mockPmLoadHistory = vi.fn(() => Promise.resolve([]));
const mockInitProjectDb = vi.fn(() => Promise.resolve());

vi.mock('../tauri/pm', () => ({
  pmLoad: (...args: unknown[]) => mockPmLoad(...args),
  pmSave: (...args: unknown[]) => mockPmSave(...args),
  pmClear: (...args: unknown[]) => mockPmClear(...args),
  pmLoadHistory: (...args: unknown[]) => mockPmLoadHistory(...args),
}));

vi.mock('../tauri/db', () => ({
  initProjectDb: (...args: unknown[]) => mockInitProjectDb(...args),
}));

function createTestStore() {
  return create<PmSlice>()((...a) => ({ ...createPmSlice(...a) }));
}

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

function makeDep(overrides: Partial<PmDependency> = {}): PmDependency {
  return {
    id: 'd1',
    sourceType: 'ticket',
    sourceId: 't1',
    targetType: 'ticket',
    targetId: 't2',
    ...overrides,
  };
}

describe('pmSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- UI state ---

  it('setPmModalOpen toggles modal', () => {
    const store = createTestStore();
    expect(store.getState().pmModalOpen).toBe(false);
    store.getState().setPmModalOpen(true);
    expect(store.getState().pmModalOpen).toBe(true);
  });

  it('setPmSelectedEpicId updates selected epic', () => {
    const store = createTestStore();
    expect(store.getState().pmSelectedEpicId).toBeNull();
    store.getState().setPmSelectedEpicId('e1');
    expect(store.getState().pmSelectedEpicId).toBe('e1');
  });

  it('setPmSelectedTicketId updates selected ticket', () => {
    const store = createTestStore();
    expect(store.getState().pmSelectedTicketId).toBeNull();
    store.getState().setPmSelectedTicketId('t1');
    expect(store.getState().pmSelectedTicketId).toBe('t1');
  });

  // --- Epics ---

  it('addEpic adds to drafts and sets dirty', () => {
    const store = createTestStore();
    const epic = makeEpic();
    store.getState().addEpic(epic);
    expect(store.getState().pmDraftEpics).toHaveLength(1);
    expect(store.getState().pmDraftEpics[0].id).toBe('e1');
    expect(store.getState().pmDirty).toBe(true);
  });

  it('updateEpic updates the correct draft', () => {
    const store = createTestStore();
    store.getState().addEpic(makeEpic({ id: 'e1' }));
    store.getState().addEpic(makeEpic({ id: 'e2', name: 'Epic 2' }));
    store.getState().updateEpic('e1', { name: 'Updated' });
    expect(store.getState().pmDraftEpics.find((e) => e.id === 'e1')?.name).toBe('Updated');
    expect(store.getState().pmDraftEpics.find((e) => e.id === 'e2')?.name).toBe('Epic 2');
  });

  it('deleteEpic cascades to tickets and test cases', () => {
    const store = createTestStore();
    store.getState().addEpic(makeEpic({ id: 'e1' }));
    store.getState().addTicket(makeTicket({ id: 't1', epicId: 'e1' }));
    store.getState().addTestCase(makeTestCase({ id: 'tc1', ticketId: 't1' }));
    store.getState().addTicket(makeTicket({ id: 't2', epicId: 'e2' }));

    store.getState().deleteEpic('e1');

    expect(store.getState().pmDraftEpics).toHaveLength(0);
    expect(store.getState().pmDraftTickets).toHaveLength(1);
    expect(store.getState().pmDraftTickets[0].id).toBe('t2');
    expect(store.getState().pmDraftTestCases).toHaveLength(0);
    expect(store.getState().pmDirty).toBe(true);
  });

  // --- Tickets ---

  it('addTicket adds to drafts and sets dirty', () => {
    const store = createTestStore();
    store.getState().addTicket(makeTicket());
    expect(store.getState().pmDraftTickets).toHaveLength(1);
    expect(store.getState().pmDirty).toBe(true);
  });

  it('updateTicket updates the correct draft', () => {
    const store = createTestStore();
    store.getState().addTicket(makeTicket({ id: 't1' }));
    store.getState().addTicket(makeTicket({ id: 't2', name: 'Ticket 2' }));
    store.getState().updateTicket('t1', { name: 'Updated' });
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't1')?.name).toBe('Updated');
    expect(store.getState().pmDraftTickets.find((t) => t.id === 't2')?.name).toBe('Ticket 2');
  });

  it('deleteTicket cascades to test cases', () => {
    const store = createTestStore();
    store.getState().addTicket(makeTicket({ id: 't1' }));
    store.getState().addTestCase(makeTestCase({ id: 'tc1', ticketId: 't1' }));
    store.getState().addTestCase(makeTestCase({ id: 'tc2', ticketId: 't2' }));

    store.getState().deleteTicket('t1');

    expect(store.getState().pmDraftTickets).toHaveLength(0);
    expect(store.getState().pmDraftTestCases).toHaveLength(1);
    expect(store.getState().pmDraftTestCases[0].id).toBe('tc2');
  });

  it('moveTicket changes epicId', () => {
    const store = createTestStore();
    store.getState().addTicket(makeTicket({ id: 't1', epicId: 'e1' }));
    store.getState().moveTicket('t1', 'e2');
    expect(store.getState().pmDraftTickets[0].epicId).toBe('e2');
    expect(store.getState().pmDirty).toBe(true);
  });

  it('archiveDoneTickets moves all done tickets to archived', () => {
    const store = createTestStore();
    store.getState().addTicket(makeTicket({ id: 't1', status: 'done' }));
    store.getState().addTicket(makeTicket({ id: 't2', status: 'open' }));
    store.getState().addTicket(makeTicket({ id: 't3', status: 'done' }));
    store.getState().archiveDoneTickets();

    const tickets = store.getState().pmDraftTickets;
    expect(tickets.find((t) => t.id === 't1')?.status).toBe('archived');
    expect(tickets.find((t) => t.id === 't2')?.status).toBe('open');
    expect(tickets.find((t) => t.id === 't3')?.status).toBe('archived');
    expect(store.getState().pmDirty).toBe(true);
  });

  // --- Test Cases ---

  it('addTestCase adds to drafts and sets dirty', () => {
    const store = createTestStore();
    store.getState().addTestCase(makeTestCase());
    expect(store.getState().pmDraftTestCases).toHaveLength(1);
    expect(store.getState().pmDirty).toBe(true);
  });

  it('updateTestCase updates the correct draft', () => {
    const store = createTestStore();
    store.getState().addTestCase(makeTestCase({ id: 'tc1' }));
    store.getState().updateTestCase('tc1', { title: 'Updated' });
    expect(store.getState().pmDraftTestCases[0].title).toBe('Updated');
  });

  it('deleteTestCase removes from drafts', () => {
    const store = createTestStore();
    store.getState().addTestCase(makeTestCase({ id: 'tc1' }));
    store.getState().addTestCase(makeTestCase({ id: 'tc2' }));
    store.getState().deleteTestCase('tc1');
    expect(store.getState().pmDraftTestCases).toHaveLength(1);
    expect(store.getState().pmDraftTestCases[0].id).toBe('tc2');
  });

  // --- Dependencies ---

  it('addDependency adds to drafts and sets dirty', () => {
    const store = createTestStore();
    store.getState().addDependency(makeDep());
    expect(store.getState().pmDraftDependencies).toHaveLength(1);
    expect(store.getState().pmDirty).toBe(true);
  });

  it('removeDependency removes from drafts', () => {
    const store = createTestStore();
    store.getState().addDependency(makeDep({ id: 'd1' }));
    store.getState().addDependency(makeDep({ id: 'd2' }));
    store.getState().removeDependency('d1');
    expect(store.getState().pmDraftDependencies).toHaveLength(1);
    expect(store.getState().pmDraftDependencies[0].id).toBe('d2');
  });

  // --- Load / Save / Discard ---

  it('loadPmData populates both persisted and draft', async () => {
    const epic = makeEpic();
    const ticket = makeTicket();
    mockPmLoad.mockResolvedValueOnce({
      epics: [epic],
      tickets: [ticket],
      testCases: [],
      dependencies: [],
    });

    const store = createTestStore();
    await store.getState().loadPmData('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(store.getState().pmEpics).toHaveLength(1);
    expect(store.getState().pmDraftEpics).toHaveLength(1);
    expect(store.getState().pmTickets).toHaveLength(1);
    expect(store.getState().pmDraftTickets).toHaveLength(1);
    expect(store.getState().pmDirty).toBe(false);
  });

  it('loadPmData archives done tickets older than 24 hours', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();

    const tOld = makeTicket({ id: 't-old', status: 'done', statusUpdatedAt: twoDaysAgo });
    const tRecent = makeTicket({ id: 't-recent', status: 'done', statusUpdatedAt: recent });
    const tOpen = makeTicket({ id: 't-open', status: 'open', statusUpdatedAt: twoDaysAgo });

    mockPmLoad.mockResolvedValueOnce({
      epics: [],
      tickets: [tOld, tRecent, tOpen],
      testCases: [],
      dependencies: [],
    });

    const store = createTestStore();
    await store.getState().loadPmData('/project');

    const tickets = store.getState().pmTickets;
    expect(tickets.find((t) => t.id === 't-old')?.status).toBe('archived');
    expect(tickets.find((t) => t.id === 't-recent')?.status).toBe('done');
    expect(tickets.find((t) => t.id === 't-open')?.status).toBe('open');
    // If we auto-archive on load, it should probably be marked as dirty or automatically saved?
    // The user said "when we recognize it, they should be moved to an archive".
    // If we do it on load, it makes sense that the state is dirty until saved.
    expect(store.getState().pmDirty).toBe(true);
  });

  it('savePmData calls IPC and syncs state', async () => {
    const store = createTestStore();
    store.getState().addEpic(makeEpic());
    expect(store.getState().pmDirty).toBe(true);

    await store.getState().savePmData('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(mockPmSave).toHaveBeenCalledWith('/project', {
      epics: store.getState().pmEpics,
      tickets: store.getState().pmTickets,
      testCases: store.getState().pmTestCases,
      dependencies: store.getState().pmDependencies,
    });
    expect(store.getState().pmDirty).toBe(false);
    expect(store.getState().pmEpics).toEqual(store.getState().pmDraftEpics);
  });

  it('discardPmChanges restores persisted state', () => {
    const store = createTestStore();

    // Simulate loaded persisted state
    const epic = makeEpic();
    store.setState({
      pmEpics: [epic],
      pmTickets: [],
      pmTestCases: [],
      pmDependencies: [],
      pmDraftEpics: [epic],
      pmDraftTickets: [],
      pmDraftTestCases: [],
      pmDraftDependencies: [],
      pmDirty: false,
    });

    // Make draft changes
    store.getState().addEpic(makeEpic({ id: 'e2', name: 'New Epic' }));
    expect(store.getState().pmDraftEpics).toHaveLength(2);
    expect(store.getState().pmDirty).toBe(true);

    // Discard
    store.getState().discardPmChanges();
    expect(store.getState().pmDraftEpics).toHaveLength(1);
    expect(store.getState().pmDraftEpics[0].id).toBe('e1');
    expect(store.getState().pmDirty).toBe(false);
  });

  // --- refreshPmData (smart merge) ---

  describe('refreshPmData', () => {
    it('unchanged items kept as-is in draft', async () => {
      const epic = makeEpic({ id: 'e1', updatedAt: '2024-01-01' });
      const ticket = makeTicket({ id: 't1', updatedAt: '2024-01-01' });

      const store = createTestStore();
      store.setState({
        pmEpics: [epic],
        pmTickets: [ticket],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [{ ...epic, name: 'User Edit' }],
        pmDraftTickets: [ticket],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: true,
      });

      // Fresh data has same updatedAt → DB unchanged
      mockPmLoad.mockResolvedValueOnce({
        epics: [epic],
        tickets: [ticket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      // Draft kept as-is (user edit preserved)
      expect(store.getState().pmDraftEpics[0].name).toBe('User Edit');
      expect(store.getState().pmDraftTickets[0]).toEqual(ticket);
    });

    it('new DB items appear in both persisted and draft', async () => {
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: false,
      });

      const newEpic = makeEpic({ id: 'e-new', updatedAt: '2024-01-02' });
      const newTicket = makeTicket({ id: 't-new', updatedAt: '2024-01-02' });

      mockPmLoad.mockResolvedValueOnce({
        epics: [newEpic],
        tickets: [newTicket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      expect(store.getState().pmEpics).toEqual([newEpic]);
      expect(store.getState().pmDraftEpics).toEqual([newEpic]);
      expect(store.getState().pmTickets).toEqual([newTicket]);
      expect(store.getState().pmDraftTickets).toEqual([newTicket]);
    });

    it('user-edited items preserved when DB changes same item', async () => {
      const original = makeTicket({ id: 't1', name: 'Original', updatedAt: '2024-01-01' });
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [original],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [{ ...original, name: 'User Edit' }],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: true,
      });

      const freshTicket = makeTicket({
        id: 't1',
        name: 'Agent Edit',
        updatedAt: '2024-01-02',
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [freshTicket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      // User wins
      expect(store.getState().pmDraftTickets[0].name).toBe('User Edit');
      // Persisted updated to fresh
      expect(store.getState().pmTickets[0].name).toBe('Agent Edit');
    });

    it('takes fresh when DB changed and user has not edited', async () => {
      const original = makeTicket({ id: 't1', name: 'Original', updatedAt: '2024-01-01' });
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [original],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [original], // draft same as old (no user edits)
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: false,
      });

      const freshTicket = makeTicket({
        id: 't1',
        name: 'Agent Edit',
        updatedAt: '2024-01-02',
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [freshTicket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      // Fresh data wins (user didn't edit)
      expect(store.getState().pmDraftTickets[0].name).toBe('Agent Edit');
      expect(store.getState().pmTickets[0].name).toBe('Agent Edit');
    });

    it('items deleted from DB removed from persisted and unedited draft', async () => {
      const ticket = makeTicket({ id: 't1', updatedAt: '2024-01-01' });
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [ticket],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [ticket], // unedited
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: false,
      });

      // Fresh data does NOT include t1
      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      expect(store.getState().pmTickets).toHaveLength(0);
      expect(store.getState().pmDraftTickets).toHaveLength(0);
    });

    it('user-created unsaved items preserved across refresh', async () => {
      const userCreated = makeTicket({
        id: 't-user',
        name: 'My New Ticket',
        updatedAt: '2024-01-01',
      });
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [], // not in persisted
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [userCreated], // only in draft
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: true,
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      expect(store.getState().pmDraftTickets).toHaveLength(1);
      expect(store.getState().pmDraftTickets[0].name).toBe('My New Ticket');
    });

    it('pmDirty cleared when no local diffs remain', async () => {
      const ticket = makeTicket({ id: 't1', updatedAt: '2024-01-01' });
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [ticket],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [ticket],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: true,
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [ticket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      expect(store.getState().pmDirty).toBe(false);
    });

    it('pmDirty stays true when local diffs remain', async () => {
      const ticket = makeTicket({ id: 't1', updatedAt: '2024-01-01' });
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [ticket],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [{ ...ticket, name: 'Edited' }],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: true,
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [ticket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      expect(store.getState().pmDirty).toBe(true);
    });

    it('status history refreshed', async () => {
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmStatusHistory: [],
        pmDirty: false,
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [],
        testCases: [],
        dependencies: [],
      });
      const historyEntry = {
        id: 'h1',
        ticketId: 't1',
        fromStatus: 'open',
        toStatus: 'in_progress',
        changedAt: '2024-01-01',
        source: 'agent',
      };
      mockPmLoadHistory.mockResolvedValueOnce([historyEntry]);

      await store.getState().refreshPmData('/project');

      expect(store.getState().pmStatusHistory).toEqual([historyEntry]);
    });

    it('auto-archive NOT triggered during refresh', async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const doneTicket = makeTicket({
        id: 't1',
        status: 'done',
        statusUpdatedAt: twoDaysAgo,
        updatedAt: '2024-01-01',
      });

      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: false,
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [doneTicket],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      // Status should remain 'done', NOT 'archived'
      expect(store.getState().pmDraftTickets[0].status).toBe('done');
      expect(store.getState().pmTickets[0].status).toBe('done');
    });

    it('does not call initProjectDb', async () => {
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: false,
      });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [],
        testCases: [],
        dependencies: [],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      expect(mockInitProjectDb).not.toHaveBeenCalled();
    });

    it('errors caught silently', async () => {
      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [],
        pmTestCases: [],
        pmDependencies: [],
        pmDraftEpics: [],
        pmDraftTickets: [],
        pmDraftTestCases: [],
        pmDraftDependencies: [],
        pmDirty: false,
      });

      mockPmLoad.mockRejectedValueOnce(new Error('IPC failed'));

      // Should not throw
      await expect(store.getState().refreshPmData('/project')).resolves.toBeUndefined();

      // State unchanged
      expect(store.getState().pmDraftTickets).toHaveLength(0);
    });

    it('merges dependencies: keeps user-created, takes fresh from DB', async () => {
      const existingDep = makeDep({ id: 'd1' });
      const userDep = makeDep({ id: 'd-user', sourceId: 't3', targetId: 't4' });

      const store = createTestStore();
      store.setState({
        pmEpics: [],
        pmTickets: [],
        pmTestCases: [],
        pmDependencies: [existingDep],
        pmDraftEpics: [],
        pmDraftTickets: [],
        pmDraftTestCases: [],
        pmDraftDependencies: [existingDep, userDep], // user added d-user
        pmDirty: true,
      });

      const freshDep = makeDep({ id: 'd1' });
      const agentDep = makeDep({ id: 'd-agent', sourceId: 't5', targetId: 't6' });

      mockPmLoad.mockResolvedValueOnce({
        epics: [],
        tickets: [],
        testCases: [],
        dependencies: [freshDep, agentDep],
      });
      mockPmLoadHistory.mockResolvedValueOnce([]);

      await store.getState().refreshPmData('/project');

      const deps = store.getState().pmDraftDependencies;
      // Should have: fresh d1, agent d-agent, user d-user
      expect(deps).toHaveLength(3);
      expect(deps.find((d) => d.id === 'd1')).toBeDefined();
      expect(deps.find((d) => d.id === 'd-agent')).toBeDefined();
      expect(deps.find((d) => d.id === 'd-user')).toBeDefined();
    });
  });
});

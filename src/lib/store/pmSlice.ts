import type { StateCreator } from 'zustand';
import type { PmEpic, PmTicket, PmTestCase, PmDependency, PmStatusHistoryEntry } from '../tauri/pm';
import {
  pmLoad as ipcPmLoad,
  pmSave as ipcPmSave,
  pmClear as ipcPmClear,
  pmLoadHistory as ipcPmLoadHistory,
} from '../tauri/pm';
import { initProjectDb } from '../tauri/db';

export interface PmSlice {
  // Persisted state (last saved)
  pmEpics: PmEpic[];
  pmTickets: PmTicket[];
  pmTestCases: PmTestCase[];
  pmDependencies: PmDependency[];
  // Draft state (local edits before save)
  pmDraftEpics: PmEpic[];
  pmDraftTickets: PmTicket[];
  pmDraftTestCases: PmTestCase[];
  pmDraftDependencies: PmDependency[];
  pmDirty: boolean;
  // UI state
  pmModalOpen: boolean;
  pmSelectedEpicId: string | null;
  pmSelectedTicketId: string | null;
  // Status history
  pmStatusHistory: PmStatusHistoryEntry[];
  pmHistoryLoading: boolean;
  // Actions
  loadPmHistory: (projectPath: string) => Promise<void>;
  setPmModalOpen: (open: boolean) => void;
  loadPmData: (projectPath: string) => Promise<void>;
  refreshPmData: (projectPath: string) => Promise<void>;
  savePmData: (projectPath: string) => Promise<void>;
  clearPmData: (projectPath: string) => Promise<void>;
  discardPmChanges: () => void;
  addEpic: (epic: PmEpic) => void;
  updateEpic: (id: string, updates: Partial<PmEpic>) => void;
  deleteEpic: (id: string) => void;
  addTicket: (ticket: PmTicket) => void;
  updateTicket: (id: string, updates: Partial<PmTicket>) => void;
  deleteTicket: (id: string) => void;
  moveTicket: (ticketId: string, newEpicId: string) => void;
  addTestCase: (tc: PmTestCase) => void;
  updateTestCase: (id: string, updates: Partial<PmTestCase>) => void;
  deleteTestCase: (id: string) => void;
  addDependency: (dep: PmDependency) => void;
  removeDependency: (id: string) => void;
  setPmSelectedEpicId: (id: string | null) => void;
  setPmSelectedTicketId: (id: string | null) => void;
  archiveDoneTickets: () => void;
}

interface Identifiable {
  id: string;
  updatedAt: string;
}

function mergeItems<T extends Identifiable>(fresh: T[], old: T[], draft: T[]): T[] {
  const oldMap = new Map(old.map((item) => [item.id, item]));
  const freshMap = new Map(fresh.map((item) => [item.id, item]));
  const draftMap = new Map(draft.map((item) => [item.id, item]));

  const result: T[] = [];

  for (const freshItem of fresh) {
    const oldItem = oldMap.get(freshItem.id);
    const draftItem = draftMap.get(freshItem.id);

    if (!oldItem) {
      // New from DB (agent created) → add to draft
      result.push(freshItem);
    } else if (freshItem.updatedAt === oldItem.updatedAt) {
      // DB unchanged → keep draft as-is
      result.push(draftItem ?? freshItem);
    } else {
      // DB changed
      if (draftItem && JSON.stringify(draftItem) === JSON.stringify(oldItem)) {
        // User hasn't edited → take fresh
        result.push(freshItem);
      } else {
        // User has local edits → keep draft (user wins)
        result.push(draftItem ?? freshItem);
      }
    }
  }

  // Draft items not in fresh
  for (const draftItem of draft) {
    if (!freshMap.has(draftItem.id)) {
      if (!oldMap.has(draftItem.id)) {
        // User-created (unsaved) → keep
        result.push(draftItem);
      }
      // else: in old but not in fresh → deleted from DB → drop
    }
  }

  return result;
}

function mergeDependencies(
  fresh: PmDependency[],
  old: PmDependency[],
  draft: PmDependency[]
): PmDependency[] {
  const oldSet = new Set(old.map((d) => d.id));
  const freshSet = new Set(fresh.map((d) => d.id));

  const result = [...fresh];

  // Add user-created deps (in draft, not in old, not in fresh)
  for (const draftDep of draft) {
    if (!oldSet.has(draftDep.id) && !freshSet.has(draftDep.id)) {
      result.push(draftDep);
    }
  }

  return result;
}

export const createPmSlice: StateCreator<PmSlice> = (set, get) => ({
  // Persisted state
  pmEpics: [],
  pmTickets: [],
  pmTestCases: [],
  pmDependencies: [],
  // Draft state
  pmDraftEpics: [],
  pmDraftTickets: [],
  pmDraftTestCases: [],
  pmDraftDependencies: [],
  pmDirty: false,
  // Status history
  pmStatusHistory: [],
  pmHistoryLoading: false,
  // UI state
  pmModalOpen: false,
  pmSelectedEpicId: null,
  pmSelectedTicketId: null,

  loadPmHistory: async (projectPath) => {
    set({ pmHistoryLoading: true });
    try {
      const history = await ipcPmLoadHistory(projectPath);
      set({ pmStatusHistory: history, pmHistoryLoading: false });
    } catch {
      set({ pmHistoryLoading: false });
    }
  },

  setPmModalOpen: (open) => set({ pmModalOpen: open }),

  loadPmData: async (projectPath) => {
    await initProjectDb(projectPath);
    const state = await ipcPmLoad(projectPath);

    // Auto-archive 'done' tickets older than 24 hours
    const now = new Date();
    let hasArchived = false;
    const processedTickets = state.tickets.map((t) => {
      if (t.status === 'done' && t.statusUpdatedAt) {
        const updatedAt = new Date(t.statusUpdatedAt);
        if (now.getTime() - updatedAt.getTime() > 24 * 60 * 60 * 1000) {
          hasArchived = true;
          return { ...t, status: 'archived' as const, statusUpdatedAt: now.toISOString() };
        }
      }
      return t;
    });

    set({
      pmEpics: state.epics,
      pmTickets: processedTickets,
      pmTestCases: state.testCases,
      pmDependencies: state.dependencies,
      pmDraftEpics: state.epics,
      pmDraftTickets: processedTickets,
      pmDraftTestCases: state.testCases,
      pmDraftDependencies: state.dependencies,
      pmDirty: hasArchived,
    });
  },

  refreshPmData: async (projectPath) => {
    try {
      const fresh = await ipcPmLoad(projectPath);
      const history = await ipcPmLoadHistory(projectPath);

      const {
        pmEpics: oldEpics,
        pmTickets: oldTickets,
        pmTestCases: oldTestCases,
        pmDependencies: oldDeps,
        pmDraftEpics: draftEpics,
        pmDraftTickets: draftTickets,
        pmDraftTestCases: draftTestCases,
        pmDraftDependencies: draftDeps,
      } = get();

      const mergedEpics = mergeItems(fresh.epics, oldEpics, draftEpics);
      const mergedTickets = mergeItems(fresh.tickets, oldTickets, draftTickets);
      const mergedTestCases = mergeItems(fresh.testCases, oldTestCases, draftTestCases);
      const mergedDeps = mergeDependencies(fresh.dependencies, oldDeps, draftDeps);

      const pmDirty =
        JSON.stringify(mergedEpics) !== JSON.stringify(fresh.epics) ||
        JSON.stringify(mergedTickets) !== JSON.stringify(fresh.tickets) ||
        JSON.stringify(mergedTestCases) !== JSON.stringify(fresh.testCases) ||
        JSON.stringify(mergedDeps) !== JSON.stringify(fresh.dependencies);

      set({
        pmEpics: fresh.epics,
        pmTickets: fresh.tickets,
        pmTestCases: fresh.testCases,
        pmDependencies: fresh.dependencies,
        pmDraftEpics: mergedEpics,
        pmDraftTickets: mergedTickets,
        pmDraftTestCases: mergedTestCases,
        pmDraftDependencies: mergedDeps,
        pmStatusHistory: history,
        pmDirty,
      });
    } catch {
      // Silently catch errors — next poll will retry
    }
  },

  savePmData: async (projectPath) => {
    await initProjectDb(projectPath);
    const { pmDraftEpics, pmDraftTickets, pmDraftTestCases, pmDraftDependencies } = get();
    await ipcPmSave(projectPath, {
      epics: pmDraftEpics,
      tickets: pmDraftTickets,
      testCases: pmDraftTestCases,
      dependencies: pmDraftDependencies,
    });
    set({
      pmEpics: pmDraftEpics,
      pmTickets: pmDraftTickets,
      pmTestCases: pmDraftTestCases,
      pmDependencies: pmDraftDependencies,
      pmDirty: false,
    });
  },

  clearPmData: async (projectPath) => {
    await initProjectDb(projectPath);
    await ipcPmClear(projectPath);
    set({
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
  },

  discardPmChanges: () => {
    const { pmEpics, pmTickets, pmTestCases, pmDependencies } = get();
    set({
      pmDraftEpics: pmEpics,
      pmDraftTickets: pmTickets,
      pmDraftTestCases: pmTestCases,
      pmDraftDependencies: pmDependencies,
      pmDirty: false,
    });
  },

  addEpic: (epic) => set((s) => ({ pmDraftEpics: [...s.pmDraftEpics, epic], pmDirty: true })),

  updateEpic: (id, updates) =>
    set((s) => ({
      pmDraftEpics: s.pmDraftEpics.map((e) => (e.id === id ? { ...e, ...updates } : e)),
      pmDirty: true,
    })),

  deleteEpic: (id) =>
    set((s) => {
      const ticketIds = s.pmDraftTickets.filter((t) => t.epicId === id).map((t) => t.id);
      return {
        pmDraftEpics: s.pmDraftEpics.filter((e) => e.id !== id),
        pmDraftTickets: s.pmDraftTickets.filter((t) => t.epicId !== id),
        pmDraftTestCases: s.pmDraftTestCases.filter((tc) => !ticketIds.includes(tc.ticketId)),
        pmDirty: true,
      };
    }),

  addTicket: (ticket) =>
    set((s) => ({ pmDraftTickets: [...s.pmDraftTickets, ticket], pmDirty: true })),

  updateTicket: (id, updates) =>
    set((s) => ({
      pmDraftTickets: s.pmDraftTickets.map((t) => {
        if (t.id === id) {
          const newStatus = updates.status;
          const statusChanged = newStatus && newStatus !== t.status;
          return {
            ...t,
            ...updates,
            statusUpdatedAt: statusChanged ? new Date().toISOString() : t.statusUpdatedAt,
          };
        }
        return t;
      }),
      pmDirty: true,
    })),

  deleteTicket: (id) =>
    set((s) => ({
      pmDraftTickets: s.pmDraftTickets.filter((t) => t.id !== id),
      pmDraftTestCases: s.pmDraftTestCases.filter((tc) => tc.ticketId !== id),
      pmDirty: true,
    })),

  moveTicket: (ticketId, newEpicId) =>
    set((s) => ({
      pmDraftTickets: s.pmDraftTickets.map((t) =>
        t.id === ticketId ? { ...t, epicId: newEpicId } : t
      ),
      pmDirty: true,
    })),

  addTestCase: (tc) =>
    set((s) => ({ pmDraftTestCases: [...s.pmDraftTestCases, tc], pmDirty: true })),

  updateTestCase: (id, updates) =>
    set((s) => ({
      pmDraftTestCases: s.pmDraftTestCases.map((tc) => (tc.id === id ? { ...tc, ...updates } : tc)),
      pmDirty: true,
    })),

  deleteTestCase: (id) =>
    set((s) => ({
      pmDraftTestCases: s.pmDraftTestCases.filter((tc) => tc.id !== id),
      pmDirty: true,
    })),

  addDependency: (dep) =>
    set((s) => ({ pmDraftDependencies: [...s.pmDraftDependencies, dep], pmDirty: true })),

  removeDependency: (id) =>
    set((s) => ({
      pmDraftDependencies: s.pmDraftDependencies.filter((d) => d.id !== id),
      pmDirty: true,
    })),

  setPmSelectedEpicId: (id) => set({ pmSelectedEpicId: id }),
  setPmSelectedTicketId: (id) => set({ pmSelectedTicketId: id }),

  archiveDoneTickets: () =>
    set((s) => {
      const now = new Date().toISOString();
      let hasArchived = false;
      const pmDraftTickets = s.pmDraftTickets.map((t) => {
        if (t.status === 'done') {
          hasArchived = true;
          return { ...t, status: 'archived' as const, statusUpdatedAt: now };
        }
        return t;
      });
      return hasArchived ? { pmDraftTickets, pmDirty: true } : s;
    }),
});

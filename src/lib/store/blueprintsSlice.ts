import type { StateCreator } from 'zustand';
import type { Blueprint, BlueprintState } from '../tauri/blueprints';
import {
  blueprintsLoad as ipcBlueprintsLoad,
  blueprintsSave as ipcBlueprintsSave,
  blueprintsClear as ipcBlueprintsClear,
} from '../tauri/blueprints';
import { initProjectDb } from '../tauri/db';
import { syncWithServer, type SyncStatus } from '../blueprints/serverSync';

const SERVER_URL_KEY = 'auric-blueprint-server-url';

export interface BlueprintsSlice {
  // Persisted state (last saved)
  blueprints: Blueprint[];
  // Draft state (local edits before save)
  blueprintsDraft: Blueprint[];
  blueprintsDirty: boolean;
  // UI state
  blueprintsModalOpen: boolean;
  selectedBlueprintId: string | null;
  // Server sync state
  blueprintServerUrl: string;
  blueprintSyncStatus: SyncStatus;
  blueprintSyncError: string | null;
  // Actions
  loadBlueprints: (projectPath: string) => Promise<void>;
  saveBlueprints: (projectPath: string) => Promise<void>;
  clearBlueprints: (projectPath: string) => Promise<void>;
  addBlueprint: (blueprint: Blueprint) => void;
  updateBlueprint: (id: string, updates: Partial<Blueprint>) => void;
  deleteBlueprint: (id: string) => void;
  discardBlueprintChanges: () => void;
  setBlueprintsModalOpen: (open: boolean) => void;
  setSelectedBlueprintId: (id: string | null) => void;
  setBlueprintServerUrl: (url: string) => void;
  loadBlueprintServerUrl: () => void;
  syncWithBlueprintServer: (projectPath: string) => Promise<void>;
}

export const createBlueprintsSlice: StateCreator<BlueprintsSlice> = (set, get) => ({
  // Persisted state
  blueprints: [],
  // Draft state
  blueprintsDraft: [],
  blueprintsDirty: false,
  // UI state
  blueprintsModalOpen: false,
  selectedBlueprintId: null,
  // Server sync state
  blueprintServerUrl: '',
  blueprintSyncStatus: 'idle',
  blueprintSyncError: null,

  loadBlueprints: async (projectPath) => {
    await initProjectDb(projectPath);
    const state: BlueprintState = await ipcBlueprintsLoad(projectPath);
    set({
      blueprints: state.blueprints,
      blueprintsDraft: state.blueprints,
      blueprintsDirty: false,
    });
    const { blueprintServerUrl } = get();
    if (blueprintServerUrl) {
      await get().syncWithBlueprintServer(projectPath);
    }
  },

  saveBlueprints: async (projectPath) => {
    await initProjectDb(projectPath);
    const { blueprintsDraft } = get();
    await ipcBlueprintsSave(projectPath, { blueprints: blueprintsDraft });
    set({
      blueprints: blueprintsDraft,
      blueprintsDirty: false,
    });
  },

  clearBlueprints: async (projectPath) => {
    await initProjectDb(projectPath);
    await ipcBlueprintsClear(projectPath);
    set({
      blueprints: [],
      blueprintsDraft: [],
      blueprintsDirty: false,
    });
  },

  addBlueprint: (blueprint) =>
    set((s) => ({ blueprintsDraft: [...s.blueprintsDraft, blueprint], blueprintsDirty: true })),

  updateBlueprint: (id, updates) =>
    set((s) => ({
      blueprintsDraft: s.blueprintsDraft.map((bp) => (bp.id === id ? { ...bp, ...updates } : bp)),
      blueprintsDirty: true,
    })),

  deleteBlueprint: (id) =>
    set((s) => ({
      blueprintsDraft: s.blueprintsDraft.filter((bp) => bp.id !== id),
      blueprintsDirty: true,
    })),

  discardBlueprintChanges: () => {
    const { blueprints } = get();
    set({
      blueprintsDraft: blueprints,
      blueprintsDirty: false,
    });
  },

  setBlueprintsModalOpen: (open) => set({ blueprintsModalOpen: open }),
  setSelectedBlueprintId: (id) => set({ selectedBlueprintId: id }),

  setBlueprintServerUrl: (url) => {
    set({ blueprintServerUrl: url });
    try {
      localStorage.setItem(SERVER_URL_KEY, url);
    } catch {
      // storage unavailable — silently ignore
    }
  },

  loadBlueprintServerUrl: () => {
    try {
      const raw = localStorage.getItem(SERVER_URL_KEY);
      if (raw !== null) {
        set({ blueprintServerUrl: raw });
      }
    } catch {
      // corrupted or unavailable — keep default
    }
  },

  syncWithBlueprintServer: async (projectPath) => {
    const { blueprintServerUrl, blueprintsDraft } = get();
    if (!blueprintServerUrl) return;

    set({ blueprintSyncStatus: 'syncing', blueprintSyncError: null });
    try {
      const { addedLocally } = await syncWithServer(blueprintServerUrl, blueprintsDraft);
      if (addedLocally.length > 0) {
        for (const bp of addedLocally) {
          get().addBlueprint(bp);
        }
        await get().saveBlueprints(projectPath);
      }
      set({ blueprintSyncStatus: 'success' });
    } catch (err) {
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && err.name === 'AbortError');
      if (isNetworkError) {
        set({ blueprintSyncStatus: 'unreachable' });
      } else {
        set({
          blueprintSyncStatus: 'error',
          blueprintSyncError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
});

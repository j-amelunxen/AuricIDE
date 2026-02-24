import type { StateCreator } from 'zustand';
import type { Blueprint, BlueprintState } from '../tauri/blueprints';
import {
  blueprintsLoad as ipcBlueprintsLoad,
  blueprintsSave as ipcBlueprintsSave,
  blueprintsClear as ipcBlueprintsClear,
} from '../tauri/blueprints';
import { initProjectDb } from '../tauri/db';

export interface BlueprintsSlice {
  // Persisted state (last saved)
  blueprints: Blueprint[];
  // Draft state (local edits before save)
  blueprintsDraft: Blueprint[];
  blueprintsDirty: boolean;
  // UI state
  blueprintsModalOpen: boolean;
  selectedBlueprintId: string | null;
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

  loadBlueprints: async (projectPath) => {
    await initProjectDb(projectPath);
    const state: BlueprintState = await ipcBlueprintsLoad(projectPath);
    set({
      blueprints: state.blueprints,
      blueprintsDraft: state.blueprints,
      blueprintsDirty: false,
    });
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
});

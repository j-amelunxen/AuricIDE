import type { StateCreator } from 'zustand';
import type {
  PmRequirement,
  PmRequirementTestLink,
  RequirementsState,
} from '../tauri/requirements';
import {
  requirementsLoad as ipcRequirementsLoad,
  requirementsSave as ipcRequirementsSave,
  requirementsClear as ipcRequirementsClear,
} from '../tauri/requirements';
import { initProjectDb } from '../tauri/db';

// --- Pure selector helpers ---

export function getStaleRequirements(
  requirements: PmRequirement[],
  staleDays: number
): PmRequirement[] {
  return requirements.filter(
    (r) =>
      r.status === 'verified' &&
      r.lastVerifiedAt !== null &&
      Date.now() - Date.parse(r.lastVerifiedAt) > staleDays * 86400000
  );
}

export function getUnverifiedRequirements(requirements: PmRequirement[]): PmRequirement[] {
  return requirements.filter((r) => r.status === 'active' || r.status === 'implemented');
}

export function getTestLinksForRequirement(
  testLinks: PmRequirementTestLink[],
  requirementId: string
): PmRequirementTestLink[] {
  return testLinks.filter((l) => l.requirementId === requirementId);
}

export interface RequirementsSlice {
  // Persisted state (last saved)
  requirements: PmRequirement[];
  requirementTestLinks: PmRequirementTestLink[];
  // Draft state (local edits before save)
  requirementsDraft: PmRequirement[];
  requirementTestLinksDraft: PmRequirementTestLink[];
  requirementsDirty: boolean;
  // Track which project is currently loaded
  currentRequirementsProject: string | null;
  // UI state
  requirementsModalOpen: boolean;
  selectedRequirementId: string | null;
  // Filters
  requirementFilterCategory: string;
  requirementFilterType: string;
  requirementFilterStatus: string;
  requirementFilterVerification: string;
  requirementSearchQuery: string;
  // Actions
  loadRequirements: (projectPath: string) => Promise<void>;
  saveRequirements: (projectPath: string) => Promise<void>;
  clearRequirements: (projectPath: string) => Promise<void>;
  resetRequirementsInMemory: () => void;
  addRequirement: (req: PmRequirement) => void;
  updateRequirement: (id: string, updates: Partial<PmRequirement>) => void;
  deleteRequirement: (id: string) => void;
  verifyRequirement: (id: string) => void;
  discardRequirementChanges: () => void;
  setRequirementsModalOpen: (open: boolean) => void;
  setSelectedRequirementId: (id: string | null) => void;
  setRequirementFilterCategory: (category: string) => void;
  setRequirementFilterType: (type: string) => void;
  setRequirementFilterStatus: (status: string) => void;
  setRequirementFilterVerification: (verification: string) => void;
  setRequirementSearchQuery: (query: string) => void;
}

export const createRequirementsSlice: StateCreator<RequirementsSlice> = (set, get) => ({
  // Persisted state
  requirements: [],
  requirementTestLinks: [],
  // Draft state
  requirementsDraft: [],
  requirementTestLinksDraft: [],
  requirementsDirty: false,
  currentRequirementsProject: null,
  // UI state
  requirementsModalOpen: false,
  selectedRequirementId: null,
  // Filters
  requirementFilterCategory: '',
  requirementFilterType: '',
  requirementFilterStatus: '',
  requirementFilterVerification: '',
  requirementSearchQuery: '',

  loadRequirements: async (projectPath) => {
    await initProjectDb(projectPath);
    const state: RequirementsState = await ipcRequirementsLoad(projectPath);
    // Rust stores applies_to as a JSON string — parse it into a real array
    const requirements = state.requirements.map((r) => ({
      ...r,
      appliesTo: typeof r.appliesTo === 'string' ? JSON.parse(r.appliesTo) : (r.appliesTo ?? []),
    }));
    const { requirementsDirty, currentRequirementsProject } = get();
    const isNewProject = currentRequirementsProject !== projectPath;

    if (!requirementsDirty || isNewProject) {
      set({
        requirements,
        requirementsDraft: requirements,
        requirementTestLinks: state.testLinks,
        requirementTestLinksDraft: state.testLinks,
        requirementsDirty: false,
        currentRequirementsProject: projectPath,
      });
    } else {
      set({
        requirements,
        requirementTestLinks: state.testLinks,
        currentRequirementsProject: projectPath,
      });
    }
  },

  saveRequirements: async (projectPath) => {
    await initProjectDb(projectPath);
    const { requirementsDraft, requirementTestLinksDraft } = get();
    // Rust expects applies_to as a JSON string
    const serialized = requirementsDraft.map((r) => ({
      ...r,
      appliesTo: Array.isArray(r.appliesTo) ? JSON.stringify(r.appliesTo) : (r.appliesTo ?? '[]'),
    }));
    await ipcRequirementsSave(projectPath, {
      requirements: serialized as unknown as PmRequirement[],
      testLinks: requirementTestLinksDraft,
    });
    set({
      requirements: requirementsDraft,
      requirementTestLinks: requirementTestLinksDraft,
      requirementsDirty: false,
    });
  },

  clearRequirements: async (projectPath) => {
    await initProjectDb(projectPath);
    await ipcRequirementsClear(projectPath);
    set({
      requirements: [],
      requirementsDraft: [],
      requirementTestLinks: [],
      requirementTestLinksDraft: [],
      requirementsDirty: false,
    });
  },

  resetRequirementsInMemory: () =>
    set({
      requirements: [],
      requirementsDraft: [],
      requirementTestLinks: [],
      requirementTestLinksDraft: [],
      requirementsDirty: false,
    }),

  addRequirement: (req) =>
    set((s) => ({ requirementsDraft: [...s.requirementsDraft, req], requirementsDirty: true })),

  updateRequirement: (id, updates) =>
    set((s) => ({
      requirementsDraft: s.requirementsDraft.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      requirementsDirty: true,
    })),

  deleteRequirement: (id) =>
    set((s) => ({
      requirementsDraft: s.requirementsDraft.filter((r) => r.id !== id),
      requirementsDirty: true,
    })),

  verifyRequirement: (id) => {
    const lastVerifiedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    set((s) => ({
      requirementsDraft: s.requirementsDraft.map((r) =>
        r.id === id ? { ...r, status: 'verified', lastVerifiedAt } : r
      ),
      requirementsDirty: true,
    }));
  },

  discardRequirementChanges: () => {
    const { requirements, requirementTestLinks } = get();
    set({
      requirementsDraft: requirements,
      requirementTestLinksDraft: requirementTestLinks,
      requirementsDirty: false,
    });
  },

  setRequirementsModalOpen: (open) => set({ requirementsModalOpen: open }),
  setSelectedRequirementId: (id) => set({ selectedRequirementId: id }),
  setRequirementFilterCategory: (category) => set({ requirementFilterCategory: category }),
  setRequirementFilterType: (type) => set({ requirementFilterType: type }),
  setRequirementFilterStatus: (status) => set({ requirementFilterStatus: status }),
  setRequirementFilterVerification: (verification) =>
    set({ requirementFilterVerification: verification }),
  setRequirementSearchQuery: (query) => set({ requirementSearchQuery: query }),
});

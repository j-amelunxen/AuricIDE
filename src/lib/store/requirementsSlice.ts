import { formatUtcStamp } from '@/lib/time/utcStamp';
import { draftDiffers, rebaseDraft } from './draftMerge';
import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import { withPersistFeedback } from './persistFeedback';
import { IDLE_LOAD_STATE, trackLoad } from './loadState';
import { writeChanged } from './stableRefs';
import type { RequirementsState } from '../tauri/requirements';
import type { PmRequirement, PmRequirementTestLink } from '../pm/types';
import {
  requirementsLoad as ipcRequirementsLoad,
  requirementsSave as ipcRequirementsSave,
} from '../tauri/requirements';
import { initProjectDb } from '../tauri/db';

/**
 * Wire format for appliesTo is either a string[] (domain) or a JSON string
 * (Rust/SQLite). Corrupt values become [] so one bad row cannot kill a load.
 */
export function parseAppliesTo(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      return [];
    }
  }
  return [];
}

export interface RequirementsSlice {
  /** True while project data is being read; distinguishes empty from not-yet. */
  requirementsLoading: boolean;
  /** Why the last load failed; null when it succeeded or never ran. */
  requirementsLoadError: string | null;
  // Persisted state (last saved)
  requirements: PmRequirement[];
  requirementTestLinks: PmRequirementTestLink[];
  // Draft state (local edits before save)
  requirementsDraft: PmRequirement[];
  requirementTestLinksDraft: PmRequirementTestLink[];
  requirementsDirty: boolean;
  currentRequirementsProject: string | null;
  // UI state
  requirementsModalOpen: boolean;
  selectedRequirementId: string | null;
  requirementFilterCategory: string;
  requirementFilterType: string;
  requirementFilterStatus: string;
  requirementFilterVerification: string;
  requirementSearchQuery: string;
  loadRequirements: (projectPath: string) => Promise<void>;
  saveRequirements: (projectPath: string) => Promise<void>;
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

export const createRequirementsSlice: StateCreator<StoreState, [], [], RequirementsSlice> = (
  set,
  get
) => ({
  // Persisted state
  requirements: [],
  requirementsLoading: IDLE_LOAD_STATE.loading,
  requirementsLoadError: IDLE_LOAD_STATE.error,
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

  loadRequirements: (projectPath) =>
    trackLoad(
      (s) =>
        writeChanged(set, get(), {
          requirementsLoading: s.loading,
          requirementsLoadError: s.error,
        }),
      async () => {
        await initProjectDb(projectPath);
        const state: RequirementsState = await ipcRequirementsLoad(projectPath);
        // Rust stores applies_to as a JSON string — parse it into a real array
        const requirements = state.requirements.map((r) => ({
          ...r,
          appliesTo: parseAppliesTo(r.appliesTo),
        }));
        const { requirementsDirty, currentRequirementsProject } = get();
        const isNewProject = currentRequirementsProject !== projectPath;

        if (!requirementsDirty || isNewProject) {
          writeChanged(set, get(), {
            requirements,
            requirementsDraft: requirements,
            requirementTestLinks: state.testLinks,
            requirementTestLinksDraft: state.testLinks,
            requirementsDirty: false,
            currentRequirementsProject: projectPath,
          });
        } else {
          // Keep the person's edits, field by field, on top of what agents wrote
          // meanwhile; a stale draft row would otherwise put their values back.
          const draft = get();
          const requirementsDraft = rebaseDraft(
            draft.requirementsDraft,
            draft.requirements,
            requirements
          );
          const requirementTestLinksDraft = rebaseDraft(
            draft.requirementTestLinksDraft,
            draft.requirementTestLinks,
            state.testLinks
          );
          writeChanged(set, get(), {
            requirements,
            requirementsDraft,
            requirementTestLinks: state.testLinks,
            requirementTestLinksDraft,
            requirementsDirty:
              draftDiffers(requirementsDraft, requirements) ||
              draftDiffers(requirementTestLinksDraft, state.testLinks),
            currentRequirementsProject: projectPath,
          });
        }
      },
      { background: get().currentRequirementsProject === projectPath }
    ),

  saveRequirements: (projectPath) =>
    withPersistFeedback(get(), 'requirements', async () => {
      // The save replaces every row; after a failed load that would delete the ones never read.
      if (get().requirementsLoadError)
        throw new Error(`the requirements did not load, so saving would replace it`);
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
    }),

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
      // Links are persisted wholesale on save — one left behind would point at
      // a requirement row that no longer exists.
      requirementTestLinksDraft: s.requirementTestLinksDraft.filter((l) => l.requirementId !== id),
      requirementsDirty: true,
    })),

  verifyRequirement: (id) => {
    const lastVerifiedAt = formatUtcStamp();
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

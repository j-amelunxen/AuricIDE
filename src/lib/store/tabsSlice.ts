import type { StoreGet } from '@/lib/store/types';
import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import { repoPathFromGraphTabId } from '@/lib/git/graphTabId';

export interface Tab {
  id: string;
  path: string;
  name: string;
  isDirty?: boolean;
}

export interface TabsSlice {
  openTabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Omit<Tab, 'isDirty'>) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToRight: (id: string) => void;
  /** null clears document focus — Mission Control takes the center stage. */
  setActiveTab: (id: string | null) => void;
  markDirty: (id: string, dirty: boolean) => void;
  /**
   * Follow a moved/renamed path: re-point any open tab for `oldPath` (or a file
   * beneath it, when a folder moved) to its new location so the tab doesn't go
   * stale. Stale diagnostics under the old path are dropped.
   */
  renamePath: (oldPath: string, newPath: string) => void;
}

/**
 * What other slices keep per tab goes with the tab: lint results (keyed by the
 * file path a tab's id is), a diff, a merge document, a review session, a git
 * graph.
 */
function onTabsClosed(get: StoreGet, ids: string[]): void {
  const store = get();
  for (const id of ids) {
    store.clearDiagnostics(id);
    store.clearDiffTab(id);
    store.closeMergeDoc(id);
    store.closeReviewSession(id);
    const graphRepo = repoPathFromGraphTabId(id);
    if (graphRepo !== null) store.closeGraph(graphRepo);
  }
}

export const createTabsSlice: StateCreator<StoreState, [], [], TabsSlice> = (set, get) => ({
  openTabs: [],
  activeTabId: null,

  openTab: (tab) => {
    const { openTabs } = get();
    const exists = openTabs.find((t) => t.id === tab.id);
    if (exists) {
      set({ activeTabId: tab.id });
    } else {
      set({
        openTabs: [...openTabs, { ...tab, isDirty: false }],
        activeTabId: tab.id,
      });
    }
  },

  closeTab: (id) => {
    const { openTabs, activeTabId } = get();
    const idx = openTabs.findIndex((t) => t.id === id);
    const newTabs = openTabs.filter((t) => t.id !== id);
    let newActiveId = activeTabId;

    if (activeTabId === id) {
      if (newTabs.length === 0) {
        newActiveId = null;
      } else if (idx > 0) {
        newActiveId = newTabs[idx - 1].id;
      } else {
        newActiveId = newTabs[0].id;
      }
    }

    set({ openTabs: newTabs, activeTabId: newActiveId });
    onTabsClosed(get, [id]);
  },

  closeOtherTabs: (id) => {
    const { openTabs } = get();
    const kept = openTabs.filter((t) => t.id === id);
    const closedIds = openTabs.filter((t) => t.id !== id).map((t) => t.id);
    set({ openTabs: kept, activeTabId: kept.length > 0 ? id : null });
    onTabsClosed(get, closedIds);
  },

  closeAllTabs: () => {
    const closedIds = get().openTabs.map((t) => t.id);
    set({ openTabs: [], activeTabId: null });
    onTabsClosed(get, closedIds);
  },

  closeTabsToRight: (id) => {
    const { openTabs, activeTabId } = get();
    const idx = openTabs.findIndex((t) => t.id === id);
    const kept = openTabs.slice(0, idx + 1);
    const closedIds = openTabs.slice(idx + 1).map((t) => t.id);
    const activeStillOpen = kept.some((t) => t.id === activeTabId);
    set({ openTabs: kept, activeTabId: activeStillOpen ? activeTabId : id });
    onTabsClosed(get, closedIds);
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  markDirty: (id, dirty) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t)),
    })),

  renamePath: (oldPath, newPath) => {
    const { openTabs, activeTabId } = get();
    const remap = (p: string): string | null => {
      if (p === oldPath) return newPath;
      if (p.startsWith(oldPath + '/')) return newPath + p.slice(oldPath.length);
      return null;
    };

    let newActiveId = activeTabId;
    const staleIds: string[] = [];
    const nextTabs = openTabs.map((t) => {
      const mappedPath = remap(t.path);
      if (mappedPath === null) return t;
      // Plain file tabs use the path as their id; synthetic tabs (diff:/mindmap)
      // embed the path, so patch it in place and keep their descriptive name.
      const isPlain = t.id === t.path;
      const newId = isPlain ? mappedPath : t.id.replace(t.path, mappedPath);
      const newName = isPlain ? (mappedPath.split('/').pop() ?? mappedPath) : t.name;
      if (activeTabId === t.id) newActiveId = newId;
      if (newId !== t.id) staleIds.push(t.id);
      return { ...t, id: newId, path: mappedPath, name: newName };
    });

    set({ openTabs: nextTabs, activeTabId: newActiveId });
    for (const id of staleIds) get().clearDiagnostics(id);
  },
});

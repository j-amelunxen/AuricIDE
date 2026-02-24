import type { StateCreator } from 'zustand';

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
  setActiveTab: (id: string) => void;
  markDirty: (id: string, dirty: boolean) => void;
}

export const createTabsSlice: StateCreator<TabsSlice> = (set, get) => ({
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
  },

  closeOtherTabs: (id) => {
    const { openTabs } = get();
    const kept = openTabs.filter((t) => t.id === id);
    set({ openTabs: kept, activeTabId: kept.length > 0 ? id : null });
  },

  closeAllTabs: () => {
    set({ openTabs: [], activeTabId: null });
  },

  closeTabsToRight: (id) => {
    const { openTabs, activeTabId } = get();
    const idx = openTabs.findIndex((t) => t.id === id);
    const kept = openTabs.slice(0, idx + 1);
    const activeStillOpen = kept.some((t) => t.id === activeTabId);
    set({ openTabs: kept, activeTabId: activeStillOpen ? activeTabId : id });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  markDirty: (id, dirty) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t)),
    })),
});

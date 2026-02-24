import type { StateCreator } from 'zustand';

const STORAGE_KEY = 'auric-recent-projects';
const MAX_RECENT = 5;

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

export interface RecentProjectsSlice {
  recentProjects: RecentProject[];
  addRecentProject: (path: string) => void;
  removeRecentProject: (path: string) => void;
  loadRecentProjects: () => void;
}

function persist(projects: RecentProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export const createRecentProjectsSlice: StateCreator<RecentProjectsSlice> = (set, get) => ({
  recentProjects: [],

  addRecentProject: (path) => {
    if (typeof path !== 'string') {
      console.error('addRecentProject: path must be a string', path);
      return;
    }
    const name = path.split('/').pop() ?? path;
    const filtered = get().recentProjects.filter((p) => p.path !== path);
    const updated = [{ path, name, openedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
    set({ recentProjects: updated });
    persist(updated);
  },

  removeRecentProject: (path) => {
    const updated = get().recentProjects.filter((p) => p.path !== path);
    set({ recentProjects: updated });
    persist(updated);
  },

  loadRecentProjects: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentProject[];
        set({ recentProjects: parsed });
      }
    } catch {
      // corrupted data — keep empty
    }
  },
});

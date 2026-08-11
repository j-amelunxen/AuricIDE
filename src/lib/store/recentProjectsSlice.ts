import type { StateCreator } from 'zustand';
import * as nativeRecentProjects from '../tauri/recentProjects';

const STORAGE_KEY = 'auric-recent-projects';
const MAX_RECENT = 50;
let syncRevision = 0;

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

export interface RecentProjectsSlice {
  recentProjects: RecentProject[];
  addRecentProject: (path: string) => void;
  removeRecentProject: (path: string) => void;
  loadRecentProjects: () => Promise<void>;
}

function persist(projects: RecentProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

function loadLegacyProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applyNativeResult(
  projects: RecentProject[],
  set: (state: Partial<RecentProjectsSlice>) => void
) {
  set({ recentProjects: projects });
  persist(projects);
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
    const revision = ++syncRevision;
    void nativeRecentProjects
      .addRecentProject(path)
      .then((projects) => {
        if (revision === syncRevision) applyNativeResult(projects, set);
      })
      .catch(() => {
        /* Browser-only development uses the localStorage fallback. */
      });
  },

  removeRecentProject: (path) => {
    const updated = get().recentProjects.filter((p) => p.path !== path);
    set({ recentProjects: updated });
    persist(updated);
    const revision = ++syncRevision;
    void nativeRecentProjects
      .removeRecentProject(path)
      .then((projects) => {
        if (revision === syncRevision) applyNativeResult(projects, set);
      })
      .catch(() => {
        /* Browser-only development uses the localStorage fallback. */
      });
  },

  loadRecentProjects: async () => {
    const revision = ++syncRevision;
    const legacyProjects = loadLegacyProjects();
    if (legacyProjects.length > 0) set({ recentProjects: legacyProjects });
    try {
      const projects =
        legacyProjects.length > 0
          ? await nativeRecentProjects.importRecentProjects(legacyProjects)
          : await nativeRecentProjects.listRecentProjects();
      if (revision === syncRevision) applyNativeResult(projects, set);
    } catch {
      // Browser-only development has no Tauri backend; keep the legacy copy.
    }
  },
});

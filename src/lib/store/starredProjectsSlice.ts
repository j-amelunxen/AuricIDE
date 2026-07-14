import type { StateCreator } from 'zustand';

const STORAGE_KEY = 'auric-starred-projects';
const MAX_STARRED = 12;

/**
 * A project the user pinned for one-click switching. Unlike {@link RecentProject},
 * a starred entry is INDEPENDENT of recency: it survives even when the project
 * falls off the (capped, recency-ordered) recent list, and its position in the
 * array is fixed at star-time. The array order IS the display order — new stars
 * append to the end so existing tiles never shift (locality / muscle memory).
 */
export interface StarredProject {
  path: string;
  name: string;
  starredAt: number;
}

export interface StarredProjectsSlice {
  starredProjects: StarredProject[];
  addStarredProject: (path: string) => void;
  removeStarredProject: (path: string) => void;
  toggleStarredProject: (path: string) => void;
  isProjectStarred: (path: string) => boolean;
  loadStarredProjects: () => void;
}

function persist(projects: StarredProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export const createStarredProjectsSlice: StateCreator<StarredProjectsSlice> = (set, get) => ({
  starredProjects: [],

  addStarredProject: (path) => {
    if (typeof path !== 'string' || path.length === 0) {
      console.error('addStarredProject: path must be a non-empty string', path);
      return;
    }
    const existing = get().starredProjects;
    // Idempotent: never duplicate and never reorder an already-starred project.
    if (existing.some((p) => p.path === path)) return;
    if (existing.length >= MAX_STARRED) return;
    const name = path.split('/').pop() || path;
    const updated = [...existing, { path, name, starredAt: Date.now() }];
    set({ starredProjects: updated });
    persist(updated);
  },

  removeStarredProject: (path) => {
    const updated = get().starredProjects.filter((p) => p.path !== path);
    set({ starredProjects: updated });
    persist(updated);
  },

  toggleStarredProject: (path) => {
    if (get().isProjectStarred(path)) {
      get().removeStarredProject(path);
    } else {
      get().addStarredProject(path);
    }
  },

  isProjectStarred: (path) => get().starredProjects.some((p) => p.path === path),

  loadStarredProjects: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StarredProject[];
        set({ starredProjects: parsed });
      }
    } catch {
      // corrupted data — keep empty
    }
  },
});

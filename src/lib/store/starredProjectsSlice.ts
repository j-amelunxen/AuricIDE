import type { StateCreator } from 'zustand';
import * as nativeStarredProjects from '../tauri/starredProjects';
import type { PermissionMode } from '../tauri/agents';

const STORAGE_KEY = 'auric-starred-projects';
const MAX_STARRED = 50;
let syncRevision = 0;

/**
 * A project the user pinned for one-click switching. Unlike {@link RecentProject},
 * a starred entry is INDEPENDENT of recency: it survives even when the project
 * falls off the (capped, recency-ordered) recent list.
 *
 * The array is kept in STAR order — new stars append, nothing reorders — but that
 * is NOT the display order: `QuickAccess` sorts tiles alphabetically by name so
 * the row stays predictable as the set grows. Star order still carries weight:
 * `starredAt` means "pinned since", and the Rust store sorts and dedupes on it
 * (`merge_starred_projects`), so both sides agree on which copy of a path wins.
 */
/**
 * The mark drawn on a tile instead of the generated initials. Absent means
 * "generate one from the path", which is what every tile did before this
 * existed. Narrowed from the backend's deliberately lenient `{kind, value}`:
 * a kind this build does not know falls back to the generated tile rather
 * than breaking the row.
 */
export type ProjectIconOverride =
  | { kind: 'glyph'; value: string }
  | { kind: 'emoji'; value: string }
  /** An image file inside the project — `value` is its absolute path, never
   *  its bytes, so the store file does not grow with every icon set. */
  | { kind: 'image'; value: string };

/** A named launch preset: one recurring task, two clicks. */
export interface QuickAccessSkill {
  id: string;
  label: string;
  prompt: string;
  /** The anchor for the other two — a model only means something inside a provider. */
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** Where an adopted entry came from, so a re-scan can tell it apart. */
  invocation?: string;
}

export interface StarredProjectSettings {
  icon?: ProjectIconOverride;
  skills: QuickAccessSkill[];
}

export interface StarredProject {
  path: string;
  name: string;
  starredAt: number;
  icon?: ProjectIconOverride;
  /**
   * Optional in TS but not in Rust: records written by builds that predate
   * this feature are still sitting in localStorage without the key. Read it
   * through {@link quickAccessSkills}, never as `project.skills.map(...)`.
   */
  skills?: QuickAccessSkill[];
}

export function quickAccessSkills(project: StarredProject): QuickAccessSkill[] {
  return project.skills ?? [];
}

/**
 * Counterpart to the backend's lenient icon struct: an unrecognised kind
 * round-trips through this build untouched but renders as the generated tile.
 */
export function isRenderableIcon(icon: unknown): icon is ProjectIconOverride {
  if (typeof icon !== 'object' || icon === null) return false;
  const candidate = icon as { kind?: unknown; value?: unknown };
  return (
    (candidate.kind === 'glyph' ||
      candidate.kind === 'emoji' ||
      candidate.kind === 'image') &&
    typeof candidate.value === 'string' &&
    candidate.value.length > 0
  );
}

export interface StarredProjectsSlice {
  starredProjects: StarredProject[];
  addStarredProject: (path: string) => void;
  removeStarredProject: (path: string) => void;
  toggleStarredProject: (path: string) => void;
  isProjectStarred: (path: string) => boolean;
  loadStarredProjects: () => Promise<void>;
  updateStarredProjectSettings: (path: string, settings: StarredProjectSettings) => void;
  setStarredProjectIcon: (path: string, icon: ProjectIconOverride | undefined) => void;
  setStarredProjectSkills: (path: string, skills: QuickAccessSkill[]) => void;
}

function loadLegacyProjects(): StarredProject[] {
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
  projects: StarredProject[],
  set: (state: Partial<StarredProjectsSlice>) => void
) {
  set({ starredProjects: projects });
  persist(projects);
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
    if (existing.length >= MAX_STARRED) {
      // Refusing a requested action has to be visible. The slice is typed as
      // StateCreator<StarredProjectsSlice>, so `get()` does not know about the
      // toast slice — reach it duck-typed, exactly as agentSlice does, rather
      // than coupling two otherwise independent slices for one notification.
      const toaster = get() as StarredProjectsSlice & {
        showToast?: (message: string, variant?: 'error' | 'success' | 'info') => number;
      };
      toaster.showToast?.(
        `Quick Access is full (${MAX_STARRED}) — remove a project first`,
        'error'
      );
      return;
    }
    const name = path.split('/').pop() || path;
    const updated = [...existing, { path, name, starredAt: Date.now() }];
    set({ starredProjects: updated });
    persist(updated);
    const revision = ++syncRevision;
    void nativeStarredProjects
      .addStarredProject(path)
      .then((projects) => {
        if (revision === syncRevision) applyNativeResult(projects, set);
      })
      .catch(() => {
        /* Browser-only development uses localStorage. */
      });
  },

  removeStarredProject: (path) => {
    const updated = get().starredProjects.filter((p) => p.path !== path);
    set({ starredProjects: updated });
    persist(updated);
    const revision = ++syncRevision;
    void nativeStarredProjects
      .removeStarredProject(path)
      .then((projects) => {
        if (revision === syncRevision) applyNativeResult(projects, set);
      })
      .catch(() => {
        /* Browser-only development uses localStorage. */
      });
  },

  toggleStarredProject: (path) => {
    if (get().isProjectStarred(path)) {
      get().removeStarredProject(path);
    } else {
      get().addStarredProject(path);
    }
  },

  isProjectStarred: (path) => get().starredProjects.some((p) => p.path === path),

  updateStarredProjectSettings: (path, settings) => {
    const existing = get().starredProjects;
    // Never resurrect an unstarred project through the settings door.
    if (!existing.some((p) => p.path === path)) return;

    // Spread, do NOT rebuild the record field by field: the whole object is
    // mirrored into localStorage verbatim, so a reconstructed one would drop
    // any field a newer build added and this one does not know about.
    const updated = existing.map((p) =>
      p.path === path ? { ...p, icon: settings.icon, skills: settings.skills } : p
    );
    set({ starredProjects: updated });
    persist(updated);
    const revision = ++syncRevision;
    void nativeStarredProjects
      .updateStarredProjectSettings(path, settings)
      .then((projects) => {
        if (revision === syncRevision) applyNativeResult(projects, set);
      })
      .catch(() => {
        /* Browser-only development uses localStorage. */
      });
  },

  setStarredProjectIcon: (path, icon) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(path, { icon, skills: quickAccessSkills(target) });
  },

  setStarredProjectSkills: (path, skills) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(path, { icon: target.icon, skills });
  },

  loadStarredProjects: async () => {
    const revision = ++syncRevision;
    const legacyProjects = loadLegacyProjects();
    if (legacyProjects.length > 0) set({ starredProjects: legacyProjects });
    try {
      const projects =
        legacyProjects.length > 0
          ? await nativeStarredProjects.importStarredProjects(legacyProjects)
          : await nativeStarredProjects.listStarredProjects();
      if (revision === syncRevision) applyNativeResult(projects, set);
    } catch {
      // Browser-only development has no Tauri backend; keep the legacy copy.
    }
  },
});

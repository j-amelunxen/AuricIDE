import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';
import { APP_CONFIG_KEYS, readAppJson, writeAppJson } from '@/lib/config/appConfig';
import * as nativeStarredProjects from '../tauri/starredProjects';
import { normalizeProjectDescription } from '../quickAccess/description';
import { normalizeProjectBadge } from '../quickAccess/badge';
import { normalizeWheelSlots } from '../quickAccess/wheel';
import { DOCK_MAX, applyDockPlace, splitDock } from '../quickAccess/dock';
import { loadAuricSkills } from '../settings/auricSkills';
import { pinSlottedLibrarySkills } from '../quickAccess/menuSkills';

const MAX_STARRED = 50;
let syncRevision = 0;

import type {
  ProjectBadge,
  ProjectIconOverride,
  QuickAccessCombo,
  QuickAccessSkill,
  StarredProject,
  StarredProjectSettings,
} from '../quickAccess/types';
import { COMBO_SLOT_PREFIX } from '../quickAccess/launchSkills';
import { quickAccessCombos, quickAccessSkills } from '../quickAccess/projectEntries';

/** The tile's stored settings with one change; everything else is sent again as it is. */
function settingsWith(
  target: StarredProject,
  change: Partial<StarredProjectSettings>
): StarredProjectSettings {
  return {
    icon: target.icon,
    skills: quickAccessSkills(target),
    combos: quickAccessCombos(target),
    wheelSlots: target.wheelSlots ?? [],
    ...change,
  };
}

function wheelIdsForSettings(
  skills: QuickAccessSkill[],
  combos: QuickAccessCombo[] | undefined
): string[] {
  const ids = skills.map((skill) => skill.id);
  for (const entry of combos ?? []) {
    ids.push(`${COMBO_SLOT_PREFIX}${entry.id}`);
    for (const step of entry.steps) ids.push(step.id);
  }
  return ids;
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
  setStarredProjectCombos: (path: string, combos: QuickAccessCombo[]) => void;
  setStarredProjectWheelSlots: (path: string, wheelSlots: (string | null)[]) => void;
  /** `null` clears the badge. A blank text clears it too, after normalisation. */
  setStarredProjectBadge: (path: string, badge: ProjectBadge | null) => void;
  /** `null` (or blank) clears it, and the README-derived description applies again. */
  setStarredProjectDescription: (path: string, description: string | null) => void;
  /**
   * A number docks the project at that place among the docked ones (or moves it
   * there); `null` takes it out. A full dock refuses a newcomer with a toast.
   */
  setStarredProjectDock: (path: string, place: number | null) => void;
}

function loadLegacyProjects(): StarredProject[] {
  const parsed = readAppJson(APP_CONFIG_KEYS.starredProjects);
  return Array.isArray(parsed) ? (parsed as StarredProject[]) : [];
}

function applyNativeResult(
  projects: StarredProject[],
  set: (state: Partial<StarredProjectsSlice>) => void
) {
  set({ starredProjects: projects });
  persist(projects);
}

function persist(projects: StarredProject[]) {
  writeAppJson(APP_CONFIG_KEYS.starredProjects, projects);
}

export const createStarredProjectsSlice: StateCreator<StoreState, [], [], StarredProjectsSlice> = (
  set,
  get
) => ({
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
      // Refusing a requested action has to be visible through the shared toast slice.
      const toaster = get();
      toaster.showToast(`Quick Access is full (${MAX_STARRED}) — remove a project first`, 'error');
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
    const updated = existing.map((p) => {
      if (p.path !== path) return p;
      // Spread, then overlay the fields this payload owns. `badge` is not one
      // of them unless the caller set it: an icon save must not wipe a lane mark.
      const next: StarredProject = {
        ...p,
        icon: settings.icon,
        skills: settings.skills,
        combos: settings.combos ?? p.combos,
        wheelSlots: normalizeWheelSlots(
          settings.wheelSlots ?? p.wheelSlots,
          wheelIdsForSettings(settings.skills, settings.combos ?? p.combos)
        ),
      };
      if (settings.badge !== undefined) {
        const normalized = normalizeProjectBadge(settings.badge);
        if (normalized) next.badge = normalized;
        else delete next.badge;
      }
      if (settings.description !== undefined) {
        const description = normalizeProjectDescription(settings.description);
        if (description) next.description = description;
        else delete next.description;
      }
      return next;
    });
    const withDock =
      settings.dockIndex === undefined
        ? updated
        : applyDockPlace(updated, path, settings.dockIndex);
    set({ starredProjects: withDock });
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
    get().updateStarredProjectSettings(path, settingsWith(target, { icon }));
  },

  setStarredProjectSkills: (path, skills) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(path, settingsWith(target, { skills }));
  },

  setStarredProjectCombos: (path, combos) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(path, settingsWith(target, { combos }));
  },

  setStarredProjectWheelSlots: (path, wheelSlots) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(
      path,
      settingsWith(target, {
        // The live wheel offers the Settings → Skills library as well; a library
        // skill put on a slot is pinned here, or the slot would not survive.
        skills: pinSlottedLibrarySkills(quickAccessSkills(target), wheelSlots, loadAuricSkills()),
        wheelSlots,
      })
    );
  },

  setStarredProjectBadge: (path, badge) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(path, settingsWith(target, { badge }));
  },

  setStarredProjectDescription: (path, description) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    get().updateStarredProjectSettings(
      path,
      settingsWith(target, { description: normalizeProjectDescription(description) })
    );
  },

  setStarredProjectDock: (path, place) => {
    const target = get().starredProjects.find((p) => p.path === path);
    if (!target) return;
    if (place !== null && target.dockIndex === undefined) {
      if (splitDock(get().starredProjects).full) {
        const toaster = get();
        toaster.showToast(`Dock is full (${DOCK_MAX}) — take a project out first`, 'error');
        return;
      }
    }
    get().updateStarredProjectSettings(path, settingsWith(target, { dockIndex: place }));
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

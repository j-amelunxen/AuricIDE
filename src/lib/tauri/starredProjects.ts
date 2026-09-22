import { invoke } from './invoke';
import type { PermissionMode } from './agents';

export type ProjectIconOverride =
  | { kind: 'glyph'; value: string }
  | { kind: 'emoji'; value: string }
  | { kind: 'image'; value: string };

export interface QuickAccessSkill {
  id: string;
  label: string;
  prompt: string;
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  invocation?: string;
  auricSkillId?: string;
}

export interface QuickAccessCombo {
  id: string;
  label: string;
  steps: QuickAccessSkill[];
}

/**
 * A lane mark on one checkout. `color` is a key, not a guarantee this build
 * paints it — unknown keys still round-trip. See `src/lib/quickAccess/badge.ts`.
 */
export interface ProjectBadge {
  text: string;
  color: string;
}

export interface StarredProjectSettings {
  icon?: ProjectIconOverride;
  skills: QuickAccessSkill[];
  combos?: QuickAccessCombo[];
  wheelSlots?: (string | null)[];
  /**
   * Omit to leave the stored badge alone. `null` clears it. An icon or skill
   * save must not mention this field, or a lane mark disappears with it.
   */
  badge?: ProjectBadge | null;
}

export interface StarredProject {
  path: string;
  name: string;
  starredAt: number;
  icon?: ProjectIconOverride;
  skills?: QuickAccessSkill[];
  combos?: QuickAccessCombo[];
  wheelSlots?: (string | null)[];
  badge?: ProjectBadge;
}

/**
 * The backend is a separate system, so its shape is an assumption until it is
 * checked. Unchecked, a null answer travelled all the way into the store and
 * only surfaced in the landing page as a null with no hint of where it came
 * from. Failing here says which command lied and what it sent instead — the
 * callers already keep their previous copy when this rejects.
 */
function expectProjectList(value: unknown, command: string): StarredProject[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${command} returned ${value === null ? 'null' : typeof value}, expected an array`
    );
  }
  return value as StarredProject[];
}

export async function listStarredProjects(): Promise<StarredProject[]> {
  return expectProjectList(await invoke('starred_projects_list'), 'starred_projects_list');
}

export async function importStarredProjects(
  legacyProjects: StarredProject[]
): Promise<StarredProject[]> {
  return expectProjectList(
    await invoke('starred_projects_import', { legacyProjects }),
    'starred_projects_import'
  );
}

export async function addStarredProject(path: string): Promise<StarredProject[]> {
  return expectProjectList(await invoke('starred_projects_add', { path }), 'starred_projects_add');
}

export async function removeStarredProject(path: string): Promise<StarredProject[]> {
  return expectProjectList(
    await invoke('starred_projects_remove', { path }),
    'starred_projects_remove'
  );
}

export async function updateStarredProjectSettings(
  path: string,
  settings: StarredProjectSettings
): Promise<StarredProject[]> {
  return expectProjectList(
    await invoke('starred_projects_update_settings', { path, settings }),
    'starred_projects_update_settings'
  );
}

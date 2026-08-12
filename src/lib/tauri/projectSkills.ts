import { invoke } from './invoke';
import type { SkillSourceRule } from '../settings/skillSources';

export type ProjectSkillSource = 'command' | 'skill';
/** Where a definition was found: inside the project, or in the user's home. */
export type ProjectSkillScope = 'project' | 'user';

export interface ProjectSkill {
  /** What you type to invoke it, e.g. "/changelog" or "/frontend:component". */
  invocation: string;
  name: string;
  description: string | null;
  source: ProjectSkillSource;
  scope: ProjectSkillScope;
  /** Absolute path of the defining file. */
  path: string;
  /** Which configured source rule produced this entry. */
  sourceId: string;
}

/**
 * The skill catalogue for one project, for offering launch presets in the
 * Quick Access settings editor. Scanned against the project directory and the
 * user's home directory, following whichever conventions are configured.
 *
 * Never rejects. Browser-mode development has no filesystem, and a caller
 * building a picker has no recovery to perform beyond showing nothing — an
 * empty catalogue and an unavailable backend look the same to the UI. This is
 * deliberately unlike `starredProjects.ts`, whose callers DO have a recovery
 * (keep the optimistic local state) and therefore see the rejection.
 */
export async function listProjectSkills(
  projectPath: string,
  sources: SkillSourceRule[]
): Promise<ProjectSkill[]> {
  if (!projectPath || sources.length === 0) return [];
  try {
    const result = await invoke<ProjectSkill[]>('project_skills_list', { projectPath, sources });
    return Array.isArray(result) ? result : [];
  } catch (error) {
    // debug, not warn: this fires on every call in browser-mode development.
    console.debug('project_skills_list unavailable', error);
    return [];
  }
}

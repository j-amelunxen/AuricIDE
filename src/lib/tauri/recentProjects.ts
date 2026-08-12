import { invoke } from './invoke';
import type { RecentProject } from '../store/recentProjectsSlice';

/**
 * The backend is a separate system, so its shape is an assumption until it is
 * checked. Unchecked, a null answer travelled all the way into the store and
 * only surfaced in the landing page as a null with no hint of where it came
 * from. Failing here says which command lied and what it sent instead — the
 * callers already keep their previous copy when this rejects.
 */
function expectProjectList(value: unknown, command: string): RecentProject[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${command} returned ${value === null ? 'null' : typeof value}, expected an array`
    );
  }
  return value as RecentProject[];
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  return expectProjectList(await invoke('recent_projects_list'), 'recent_projects_list');
}

export async function importRecentProjects(
  legacyProjects: RecentProject[]
): Promise<RecentProject[]> {
  return expectProjectList(
    await invoke('recent_projects_import', { legacyProjects }),
    'recent_projects_import'
  );
}

export async function addRecentProject(path: string): Promise<RecentProject[]> {
  return expectProjectList(await invoke('recent_projects_add', { path }), 'recent_projects_add');
}

export async function removeRecentProject(path: string): Promise<RecentProject[]> {
  return expectProjectList(
    await invoke('recent_projects_remove', { path }),
    'recent_projects_remove'
  );
}

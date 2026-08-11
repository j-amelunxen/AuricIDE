import { invoke } from './invoke';
import type { RecentProject } from '../store/recentProjectsSlice';

export function listRecentProjects(): Promise<RecentProject[]> {
  return invoke('recent_projects_list');
}

export function importRecentProjects(legacyProjects: RecentProject[]): Promise<RecentProject[]> {
  return invoke('recent_projects_import', { legacyProjects });
}

export function addRecentProject(path: string): Promise<RecentProject[]> {
  return invoke('recent_projects_add', { path });
}

export function removeRecentProject(path: string): Promise<RecentProject[]> {
  return invoke('recent_projects_remove', { path });
}

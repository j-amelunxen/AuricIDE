import { invoke } from './invoke';
import type { StarredProject } from '../store/starredProjectsSlice';

export function listStarredProjects(): Promise<StarredProject[]> {
  return invoke('starred_projects_list');
}

export function importStarredProjects(legacyProjects: StarredProject[]): Promise<StarredProject[]> {
  return invoke('starred_projects_import', { legacyProjects });
}

export function addStarredProject(path: string): Promise<StarredProject[]> {
  return invoke('starred_projects_add', { path });
}

export function removeStarredProject(path: string): Promise<StarredProject[]> {
  return invoke('starred_projects_remove', { path });
}

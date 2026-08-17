import type { InboxItem } from '@/lib/tauri/inbox';
import { MAX_RECENT, type RecentProject } from '@/lib/store/recentProjectsSlice';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

export interface InboxOverviewPathSources {
  starredProjects: StarredProject[];
  recentProjects: RecentProject[];
  rootPath: string | null;
  items: InboxItem[];
}

/**
 * Which projects the inbox needs a live PM overview for: everywhere the
 * assign picker could point (starred, recently opened, the open project) plus
 * every project an item is already assigned to — otherwise a project that
 * fell out of "recent" would show a stale ticket status forever.
 *
 * The recent-projects slice is the one place `MAX_RECENT` is defined, and the
 * picker (`projectPickerOptions`) offers every project up to that cap — this
 * has to cap at the same number, or a project the picker can still target
 * would have no overview data to show once assigned.
 */
export function inboxOverviewPaths({
  starredProjects,
  recentProjects,
  rootPath,
  items,
}: InboxOverviewPathSources): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };

  for (const project of starredProjects) add(project.path);

  const recentByNewest = [...recentProjects]
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, MAX_RECENT);
  for (const project of recentByNewest) add(project.path);

  if (rootPath !== null && rootPath !== '') add(rootPath);

  for (const item of items) {
    if (item.projectPath !== null) add(item.projectPath);
  }

  return paths;
}

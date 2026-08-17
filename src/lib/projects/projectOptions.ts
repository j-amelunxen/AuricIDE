import type { RecentProject } from '@/lib/store/recentProjectsSlice';
import type { ProjectIconOverride, StarredProject } from '@/lib/store/starredProjectsSlice';

/** One entry in a project picker (the schedule editor, the inbox assign flow, …). */
export interface ProjectPickerOption {
  path: string;
  name: string;
  icon?: ProjectIconOverride;
  /** Pinned in Quick Access, as opposed to merely opened recently. */
  starred: boolean;
}

export interface ProjectPickerSources {
  starred: StarredProject[];
  recent: RecentProject[];
  /** The project currently open in the IDE, if any. */
  openPath: string | null;
  /**
   * A project the caller already points at and must keep offering even if it
   * is neither pinned nor recent — e.g. the schedule being edited. Optional:
   * callers with no such notion (the inbox assign picker) simply omit it.
   */
  bound?: { path: string; name: string | null } | null;
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * Which projects a picker can be aimed at.
 *
 * Pinned projects lead — they are the ones the user curated, and Quick Access
 * already sorts them alphabetically, so the picker reads the same way. Recently
 * opened projects follow in recency order for the ones never pinned.
 *
 * Two entries are appended only when nothing else covers them, and both exist
 * to stop the picker from quietly changing what a selection points at: the open
 * project (so a scratch checkout can be chosen without pinning it first), and
 * a caller-supplied bound project (e.g. a schedule's own project). A reminder
 * for a project since unpinned and long unopened must keep pointing there — a
 * picker that cannot represent the stored value would retarget it to whatever
 * it does show, and the reminder would run a skill in the wrong repository.
 */
export function projectPickerOptions(sources: ProjectPickerSources): ProjectPickerOption[] {
  const options: ProjectPickerOption[] = [];
  const seen = new Set<string>();

  const add = (option: ProjectPickerOption) => {
    if (seen.has(option.path)) return;
    seen.add(option.path);
    options.push(option);
  };

  for (const project of [...sources.starred].sort((a, b) => a.name.localeCompare(b.name))) {
    add({
      path: project.path,
      name: project.name,
      ...(project.icon !== undefined ? { icon: project.icon } : {}),
      starred: true,
    });
  }

  for (const project of [...sources.recent].sort((a, b) => b.openedAt - a.openedAt)) {
    add({ path: project.path, name: project.name, starred: false });
  }

  if (sources.openPath !== null && sources.openPath !== '') {
    add({ path: sources.openPath, name: folderName(sources.openPath), starred: false });
  }

  const bound = sources.bound ?? null;
  if (bound !== null && bound.path !== '') {
    add({
      path: bound.path,
      name: bound.name !== null && bound.name !== '' ? bound.name : folderName(bound.path),
      starred: false,
    });
  }

  return options;
}

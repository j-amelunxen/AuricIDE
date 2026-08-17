import { projectPickerOptions, type ProjectPickerOption } from '@/lib/projects/projectOptions';
import type { RecentProject } from '@/lib/store/recentProjectsSlice';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

export interface InboxProjectOptionsSources {
  starred: StarredProject[];
  recent: RecentProject[];
  openPath: string | null;
}

/**
 * Which projects an inbox item can be assigned to.
 *
 * Built on {@link projectPickerOptions} — same picker the schedule editor
 * uses — minus its `bound` project, which has no equivalent here: an inbox
 * item has no project until the moment it is assigned.
 */
export function inboxProjectOptions(sources: InboxProjectOptionsSources): ProjectPickerOption[] {
  return projectPickerOptions(sources);
}

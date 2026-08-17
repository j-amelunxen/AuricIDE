'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { inboxOverviewPaths } from './inboxOverviewPaths';

/** How often the cross-project overview re-checks itself while idle. */
const REFRESH_INTERVAL_MS = 30_000;

/** A key that only changes when the SET of assigned projects changes — not on
 * every edit to an item — so renaming a task never triggers an overview
 * refresh nobody asked for. */
function assignedProjectsKey(items: { projectPath: string | null }[]): string {
  const paths = new Set<string>();
  for (const item of items) {
    if (item.projectPath !== null) paths.add(item.projectPath);
  }
  return [...paths].sort().join('|');
}

/**
 * Keeps the app-global inbox in step with reality.
 *
 * The inbox spans projects, so — like {@link useNotificationInbox} — it does
 * not depend on which one is open and loads once, here, rather than wherever
 * the panel happens to be mounted. That matters for the sidebar badge and the
 * start-screen summary too: both need `inboxItems` and `inboxOverview` warm
 * before either UI has been shown once.
 *
 * The overview refresh is a union of everywhere the assign picker could point
 * plus every project an item is already assigned to (see
 * {@link inboxOverviewPaths}), re-run on mount, whenever the set of assigned
 * projects changes, on a 30s timer that skips a hidden tab, and once more the
 * moment a hidden tab becomes visible again (otherwise coming back can show
 * up to 30s of stale ticket statuses).
 *
 * All of that is gated on `inboxItems.length > 0`. An empty inbox has no
 * ticket status to show anyone, so there is nothing worth dozens of project
 * db reads for — `loadInbox` itself is the one thing that always runs, since
 * it is what would turn the inbox non-empty in the first place.
 */
export function useInboxData(): void {
  const inboxItems = useStore((s) => s.inboxItems);
  const starredProjects = useStore((s) => s.starredProjects);
  const recentProjects = useStore((s) => s.recentProjects);
  const rootPath = useStore((s) => s.rootPath);
  const loadInbox = useStore((s) => s.loadInbox);
  const refreshInboxOverview = useStore((s) => s.refreshInboxOverview);

  useEffect(() => {
    void loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasItems = inboxItems.length > 0;
  const projectsKey = assignedProjectsKey(inboxItems);

  useEffect(() => {
    if (!hasItems) return;

    const refresh = () => {
      const paths = inboxOverviewPaths({
        starredProjects,
        recentProjects,
        rootPath,
        items: inboxItems,
      });
      if (paths.length === 0) return;
      void refreshInboxOverview(paths);
    };

    refresh();

    const id = window.setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems, projectsKey, starredProjects, recentProjects, rootPath, refreshInboxOverview]);
}

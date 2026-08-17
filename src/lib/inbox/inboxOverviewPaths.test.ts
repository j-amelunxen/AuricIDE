import { describe, expect, it } from 'vitest';
import { inboxOverviewPaths } from './inboxOverviewPaths';
import type { InboxItem } from '@/lib/tauri/inbox';
import { MAX_RECENT, type RecentProject } from '@/lib/store/recentProjectsSlice';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Task',
    notes: '',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

describe('inboxOverviewPaths', () => {
  it('unions starred, recent, the open project and every assigned item project', () => {
    const starred: StarredProject[] = [{ path: '/repos/alpha', name: 'alpha', starredAt: 1 }];
    const recent: RecentProject[] = [{ path: '/repos/beta', name: 'beta', openedAt: 1 }];
    const items = [makeItem({ projectPath: '/repos/gamma' })];

    const paths = inboxOverviewPaths({
      starredProjects: starred,
      recentProjects: recent,
      rootPath: '/repos/delta',
      items,
    });

    expect(paths).toEqual(['/repos/alpha', '/repos/beta', '/repos/delta', '/repos/gamma']);
  });

  it('deduplicates a path that appears in more than one source', () => {
    const starred: StarredProject[] = [{ path: '/repos/alpha', name: 'alpha', starredAt: 1 }];
    const items = [makeItem({ projectPath: '/repos/alpha' })];

    const paths = inboxOverviewPaths({
      starredProjects: starred,
      recentProjects: [],
      rootPath: '/repos/alpha',
      items,
    });

    expect(paths).toEqual(['/repos/alpha']);
  });

  it('ignores unassigned items', () => {
    const paths = inboxOverviewPaths({
      starredProjects: [],
      recentProjects: [],
      rootPath: null,
      items: [makeItem({ projectPath: null })],
    });

    expect(paths).toEqual([]);
  });

  it('caps recent projects at the same limit the picker offers (MAX_RECENT), not a smaller one', () => {
    // Capping this list tighter than the picker's own MAX_RECENT would make a
    // project the picker can still target (say, the 40th most recent) vanish
    // from the inbox's overview fetch — its epic step would have no data.
    const recent: RecentProject[] = Array.from({ length: MAX_RECENT + 10 }, (_, i) => ({
      path: `/repos/r${i}`,
      name: `r${i}`,
      openedAt: i,
    }));

    const paths = inboxOverviewPaths({
      starredProjects: [],
      recentProjects: recent,
      rootPath: null,
      items: [],
    });

    expect(paths).toHaveLength(MAX_RECENT);
    // The most recently opened MAX_RECENT, not the oldest ones.
    expect(paths).toContain(`/repos/r${MAX_RECENT + 9}`);
    expect(paths).not.toContain('/repos/r0');
  });

  it('omits a null open project rather than including it as a path', () => {
    const paths = inboxOverviewPaths({
      starredProjects: [],
      recentProjects: [],
      rootPath: null,
      items: [],
    });

    expect(paths).toEqual([]);
  });
});

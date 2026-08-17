import { describe, expect, it } from 'vitest';
import type { RecentProject } from '@/lib/store/recentProjectsSlice';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { inboxProjectOptions } from './inboxProjectOptions';

const starred = (path: string, name: string): StarredProject => ({ path, name, starredAt: 1 });
const recent = (path: string, name: string, openedAt: number): RecentProject => ({
  path,
  name,
  openedAt,
});

describe('inboxProjectOptions', () => {
  it('lists pinned projects first, alphabetically', () => {
    const options = inboxProjectOptions({
      starred: [starred('/repo/zebra', 'zebra'), starred('/repo/alpha', 'alpha')],
      recent: [],
      openPath: null,
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/alpha', '/repo/zebra']);
  });

  it('appends recent projects after the pinned ones, deduplicated', () => {
    const options = inboxProjectOptions({
      starred: [starred('/repo/alpha', 'alpha')],
      recent: [recent('/repo/alpha', 'alpha', 20), recent('/repo/beta', 'beta', 10)],
      openPath: null,
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/alpha', '/repo/beta']);
  });

  it('includes the currently open project even when it is neither pinned nor recent', () => {
    const options = inboxProjectOptions({
      starred: [],
      recent: [],
      openPath: '/repo/scratch',
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/scratch']);
  });

  it('has no bound-project entry, unlike the schedule picker it is built on', () => {
    const options = inboxProjectOptions({
      starred: [starred('/repo/alpha', 'alpha')],
      recent: [],
      openPath: null,
    });

    expect(options).toEqual([{ path: '/repo/alpha', name: 'alpha', starred: true }]);
  });
});

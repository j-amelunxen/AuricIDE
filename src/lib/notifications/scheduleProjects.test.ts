import { describe, expect, it } from 'vitest';
import type { RecentProject } from '@/lib/store/recentProjectsSlice';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import { scheduleProjectOptions } from './scheduleProjects';

const starred = (
  path: string,
  name: string,
  extra: Partial<StarredProject> = {}
): StarredProject => ({
  path,
  name,
  starredAt: 1,
  ...extra,
});

const recent = (path: string, name: string, openedAt: number): RecentProject => ({
  path,
  name,
  openedAt,
});

describe('scheduleProjectOptions', () => {
  it('offers the Quick Access projects first, alphabetically', () => {
    const options = scheduleProjectOptions({
      starred: [starred('/repo/zebra', 'zebra'), starred('/repo/alpha', 'alpha')],
      recent: [],
      openPath: null,
      bound: null,
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/alpha', '/repo/zebra']);
    expect(options.every((o) => o.starred)).toBe(true);
  });

  it('appends recently opened projects in recency order, after the pinned ones', () => {
    const options = scheduleProjectOptions({
      starred: [starred('/repo/alpha', 'alpha')],
      recent: [recent('/repo/older', 'older', 10), recent('/repo/newer', 'newer', 20)],
      openPath: null,
      bound: null,
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/alpha', '/repo/newer', '/repo/older']);
    expect(options.filter((o) => !o.starred).map((o) => o.name)).toEqual(['newer', 'older']);
  });

  it('lists a project only once when it is both pinned and recent', () => {
    const options = scheduleProjectOptions({
      starred: [starred('/repo/alpha', 'alpha')],
      recent: [recent('/repo/alpha', 'alpha', 20)],
      openPath: '/repo/alpha',
      bound: null,
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/alpha']);
    expect(options[0].starred).toBe(true);
  });

  it('includes the open project even when it is neither pinned nor in the recent list', () => {
    const options = scheduleProjectOptions({
      starred: [],
      recent: [],
      openPath: '/repo/scratch',
      bound: null,
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/scratch']);
    expect(options[0].name).toBe('scratch');
  });

  // Dropping it would silently retarget the reminder onto whatever the picker
  // happened to select instead — the one failure worth the extra branch.
  it("keeps the schedule's own project listed after it was unpinned and forgotten", () => {
    const options = scheduleProjectOptions({
      starred: [starred('/repo/alpha', 'alpha')],
      recent: [],
      openPath: null,
      bound: { path: '/repo/retired', name: 'retired-project' },
    });

    expect(options.map((o) => o.path)).toEqual(['/repo/alpha', '/repo/retired']);
    expect(options.at(-1)?.name).toBe('retired-project');
  });

  it('falls back to the folder name when the bound project has none stored', () => {
    const options = scheduleProjectOptions({
      starred: [],
      recent: [],
      openPath: null,
      bound: { path: '/repo/retired', name: null },
    });

    expect(options[0].name).toBe('retired');
  });

  it('carries the pinned icon so the picker draws the same tile Quick Access does', () => {
    const options = scheduleProjectOptions({
      starred: [starred('/repo/alpha', 'alpha', { icon: { kind: 'emoji', value: '🚀' } })],
      recent: [],
      openPath: null,
      bound: null,
    });

    expect(options[0].icon).toEqual({ kind: 'emoji', value: '🚀' });
  });
});

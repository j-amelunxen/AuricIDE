import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  addRecentProject,
  importRecentProjects,
  listRecentProjects,
  removeRecentProject,
} from './recentProjects';

/**
 * Every function here promises `RecentProject[]`. The backend is a separate
 * system, so that promise is an assumption until it is checked — and an
 * unchecked one put a null straight into the store, where it surfaced far away
 * as "Cannot read properties of null (reading 'length')" in the landing page.
 * The boundary is where the mismatch has to be caught and named.
 */
describe('recent projects boundary', () => {
  beforeEach(() => mockInvoke.mockReset());

  const calls = [
    ['listRecentProjects', () => listRecentProjects(), 'recent_projects_list'],
    ['importRecentProjects', () => importRecentProjects([]), 'recent_projects_import'],
    ['addRecentProject', () => addRecentProject('/p'), 'recent_projects_add'],
    ['removeRecentProject', () => removeRecentProject('/p'), 'recent_projects_remove'],
  ] as const;

  it.each(calls)('%s passes a real list through untouched', async (_name, call) => {
    const projects = [{ path: '/p', name: 'p', openedAt: 1 }];
    mockInvoke.mockResolvedValue(projects);

    await expect(call()).resolves.toEqual(projects);
  });

  it.each(calls)('%s rejects when the backend answers null', async (_name, call, command) => {
    mockInvoke.mockResolvedValue(null);

    // Named precisely enough to locate the fault: which command, what arrived.
    await expect(call()).rejects.toThrow(new RegExp(`${command}.*null.*array`));
  });

  it.each(calls)('%s rejects when the backend answers an object', async (_name, call) => {
    mockInvoke.mockResolvedValue({ nope: true });

    await expect(call()).rejects.toThrow(/expected an array/);
  });

  it('reports undefined distinctly from null', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await expect(listRecentProjects()).rejects.toThrow(/undefined/);
  });
});

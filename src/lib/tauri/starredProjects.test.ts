import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import {
  addStarredProject,
  importStarredProjects,
  listStarredProjects,
  removeStarredProject,
} from './starredProjects';

/**
 * Same boundary gap recentProjects.ts closed: every function here promises
 * `StarredProject[]`, but the backend is a separate system, so that promise
 * is an assumption until it is checked. Unchecked, a null answer reaches the
 * store and only surfaces far away as "Cannot read properties of null" on
 * the landing page — with no hint of which command lied.
 */
describe('starred projects boundary', () => {
  beforeEach(() => mockInvoke.mockReset());

  const calls = [
    ['listStarredProjects', () => listStarredProjects(), 'starred_projects_list'],
    ['importStarredProjects', () => importStarredProjects([]), 'starred_projects_import'],
    ['addStarredProject', () => addStarredProject('/p'), 'starred_projects_add'],
    ['removeStarredProject', () => removeStarredProject('/p'), 'starred_projects_remove'],
  ] as const;

  it.each(calls)('%s passes a real list through untouched', async (_name, call) => {
    const projects = [{ path: '/p', name: 'p', starredAt: 1 }];
    mockInvoke.mockResolvedValue(projects);

    await expect(call()).resolves.toEqual(projects);
  });

  it.each(calls)('%s rejects when the backend answers null', async (_name, call, command) => {
    mockInvoke.mockResolvedValue(null);

    await expect(call()).rejects.toThrow(new RegExp(`${command}.*null.*array`));
  });

  it.each(calls)('%s rejects when the backend answers an object', async (_name, call) => {
    mockInvoke.mockResolvedValue({ nope: true });

    await expect(call()).rejects.toThrow(/expected an array/);
  });

  it('reports undefined distinctly from null', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await expect(listStarredProjects()).rejects.toThrow(/undefined/);
  });
});

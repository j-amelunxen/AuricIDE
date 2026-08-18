import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dirtyByPath, loadProjectsDirty } from './projectDirty';

const mockGetProjectsDirty = vi.fn();

vi.mock('@/lib/tauri/git', () => ({
  getProjectsDirty: (...args: unknown[]) => mockGetProjectsDirty(...args),
}));

describe('dirtyByPath', () => {
  it('indexes each row by the path the backend echoed', () => {
    expect(
      dirtyByPath([
        { path: '/a/website', dirty: true },
        { path: '/a/apps', dirty: false },
      ])
    ).toEqual({ '/a/website': true, '/a/apps': false });
  });

  it('treats an empty batch as no dirty projects', () => {
    expect(dirtyByPath([])).toEqual({});
  });
});

describe('loadProjectsDirty', () => {
  beforeEach(() => {
    mockGetProjectsDirty.mockReset();
  });

  it('does not call IPC when there is nothing to check', async () => {
    await expect(loadProjectsDirty([])).resolves.toEqual({});
    expect(mockGetProjectsDirty).not.toHaveBeenCalled();
  });

  it('maps the backend rows onto the paths that were asked about', async () => {
    mockGetProjectsDirty.mockResolvedValueOnce([
      { path: '/a/website', dirty: true },
      { path: '/a/apps', dirty: false },
    ]);
    await expect(loadProjectsDirty(['/a/website', '/a/apps'])).resolves.toEqual({
      '/a/website': true,
      '/a/apps': false,
    });
    expect(mockGetProjectsDirty).toHaveBeenCalledWith(['/a/website', '/a/apps']);
  });

  it('returns an empty map when IPC is unavailable, so tiles stay unmarked', async () => {
    mockGetProjectsDirty.mockRejectedValueOnce(new Error('Tauri IPC is unavailable'));
    await expect(loadProjectsDirty(['/a/website'])).resolves.toEqual({});
  });
});

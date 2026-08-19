import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRepoRef } from '@/lib/tauri/git';
import { isGitRepoRoot, workingDirectoryHasGitRepo } from './worktreeDefault';

const mockExists = vi.fn<(path: string) => Promise<boolean>>();

vi.mock('@/lib/tauri/fs', () => ({
  exists: (path: string) => mockExists(path),
}));

function repo(path: string): GitRepoRef {
  return { path, relativePath: '', name: 'repo', kind: 'root' };
}

describe('isGitRepoRoot', () => {
  const repos = [repo('/w'), repo('/w/api')];

  it('is false when the working directory is empty', () => {
    expect(isGitRepoRoot('', repos)).toBe(false);
    expect(isGitRepoRoot('   ', repos)).toBe(false);
  });

  it('is true when the working directory is a known repo root', () => {
    expect(isGitRepoRoot('/w', repos)).toBe(true);
    expect(isGitRepoRoot('/w/api', repos)).toBe(true);
  });

  it('tolerates a trailing slash on either side', () => {
    expect(isGitRepoRoot('/w/', repos)).toBe(true);
    expect(isGitRepoRoot('/w', [repo('/w/')])).toBe(true);
  });

  it('is false for a folder inside a repo that is not itself a repo root', () => {
    expect(isGitRepoRoot('/w/src', repos)).toBe(false);
  });

  it('is false when nothing matches', () => {
    expect(isGitRepoRoot('/elsewhere', repos)).toBe(false);
    expect(isGitRepoRoot('/w', [])).toBe(false);
  });
});

describe('workingDirectoryHasGitRepo', () => {
  beforeEach(() => {
    mockExists.mockReset();
  });

  it('is true for a known repo root without probing the filesystem', async () => {
    await expect(workingDirectoryHasGitRepo('/w', [repo('/w')])).resolves.toBe(true);
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('is false when the working directory is empty', async () => {
    await expect(workingDirectoryHasGitRepo('', [])).resolves.toBe(false);
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('probes .git when the path is not a known repo', async () => {
    mockExists.mockResolvedValueOnce(true);
    await expect(workingDirectoryHasGitRepo('/other/repo', [])).resolves.toBe(true);
    expect(mockExists).toHaveBeenCalledWith('/other/repo/.git');
  });

  it('is false when .git is missing', async () => {
    mockExists.mockResolvedValueOnce(false);
    await expect(workingDirectoryHasGitRepo('/not-a-repo', [])).resolves.toBe(false);
  });

  it('is false when the probe cannot run', async () => {
    mockExists.mockRejectedValueOnce(new Error('Tauri IPC is unavailable'));
    await expect(workingDirectoryHasGitRepo('/maybe', [])).resolves.toBe(false);
  });
});

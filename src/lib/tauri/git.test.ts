import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('git IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getGitStatus returns file statuses', async () => {
    mockInvoke.mockResolvedValueOnce([{ path: 'file.md', status: 'modified' }]);
    const { getGitStatus } = await import('./git');
    const result = await getGitStatus('/repo');
    expect(result).toEqual([{ path: 'file.md', status: 'modified' }]);
    expect(mockInvoke).toHaveBeenCalledWith('git_status', { repoPath: '/repo' });
  });

  it('getBranchInfo returns branch info', async () => {
    mockInvoke.mockResolvedValueOnce({ name: 'main', ahead: 0, behind: 1 });
    const { getBranchInfo } = await import('./git');
    const result = await getBranchInfo('/repo');
    expect(result).toEqual({ name: 'main', ahead: 0, behind: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('git_branch_info', { repoPath: '/repo' });
  });

  it('commitChanges returns commit oid', async () => {
    mockInvoke.mockResolvedValueOnce('abc123');
    const { commitChanges } = await import('./git');
    const result = await commitChanges('/repo', 'test');
    expect(result).toBe('abc123');
    expect(mockInvoke).toHaveBeenCalledWith('git_commit', { repoPath: '/repo', message: 'test' });
  });

  it('stageFiles does not throw', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const { stageFiles } = await import('./git');
    await expect(stageFiles('/repo', ['file.md'])).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('git_stage', { repoPath: '/repo', paths: ['file.md'] });
  });

  it('unstageFiles does not throw', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const { unstageFiles } = await import('./git');
    await expect(unstageFiles('/repo', ['file.md'])).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('git_unstage', {
      repoPath: '/repo',
      paths: ['file.md'],
    });
  });
});

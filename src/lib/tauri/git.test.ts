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
    mockInvoke.mockResolvedValueOnce([
      { path: 'file.md', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    const { getGitStatus } = await import('./git');
    const result = await getGitStatus('/repo');
    expect(result).toEqual([
      { path: 'file.md', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
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

  it('getGitDiff omits side when not given', async () => {
    mockInvoke.mockResolvedValueOnce('diff');
    const { getGitDiff } = await import('./git');
    await expect(getGitDiff('/repo', 'file.md')).resolves.toBe('diff');
    expect(mockInvoke).toHaveBeenCalledWith('git_diff', { repoPath: '/repo', filePath: 'file.md' });
  });

  it('getGitDiff passes side when given', async () => {
    mockInvoke.mockResolvedValueOnce('staged-diff');
    const { getGitDiff } = await import('./git');
    await expect(getGitDiff('/repo', 'file.md', 'staged')).resolves.toBe('staged-diff');
    expect(mockInvoke).toHaveBeenCalledWith('git_diff', {
      repoPath: '/repo',
      filePath: 'file.md',
      side: 'staged',
    });
  });

  it('listGitBranches invokes git_list_branches', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'main', kind: 'local', isCurrent: true }]);
    const { listGitBranches } = await import('./git');
    const result = await listGitBranches('/repo');
    expect(result).toEqual([{ name: 'main', kind: 'local', isCurrent: true }]);
    expect(mockInvoke).toHaveBeenCalledWith('git_list_branches', { repoPath: '/repo' });
  });

  it('gitBlame invokes git_blame', async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        oid: 'abc',
        author: 'Test',
        timestamp: '2026-01-01 00:00:00',
        summary: 'init',
        startLine: 1,
        lineCount: 2,
      },
    ]);
    const { gitBlame } = await import('./git');
    const result = await gitBlame('/repo', 'file.md');
    expect(result).toHaveLength(1);
    expect(result[0].startLine).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith('git_blame', {
      repoPath: '/repo',
      filePath: 'file.md',
    });
  });

  it('getGitDiffCommit invokes git_diff_commit', async () => {
    mockInvoke.mockResolvedValueOnce('commit-diff');
    const { getGitDiffCommit } = await import('./git');
    await expect(getGitDiffCommit('/repo', 'abc123', 'file.md')).resolves.toBe('commit-diff');
    expect(mockInvoke).toHaveBeenCalledWith('git_diff_commit', {
      repoPath: '/repo',
      oid: 'abc123',
      filePath: 'file.md',
    });
  });

  it('getGitDiffRefFiles invokes git_diff_ref_files', async () => {
    mockInvoke.mockResolvedValueOnce([{ path: 'file.md', status: 'modified' }]);
    const { getGitDiffRefFiles } = await import('./git');
    const result = await getGitDiffRefFiles('/repo', 'main');
    expect(result).toEqual([{ path: 'file.md', status: 'modified' }]);
    expect(mockInvoke).toHaveBeenCalledWith('git_diff_ref_files', {
      repoPath: '/repo',
      refName: 'main',
    });
  });

  it('discoverGitRepos invokes git_discover_repos and returns the repo refs', async () => {
    mockInvoke.mockResolvedValueOnce([
      { path: '/w', relativePath: '', name: 'w', kind: 'root' },
      { path: '/w/api', relativePath: 'api', name: 'api', kind: 'nested' },
    ]);
    const { discoverGitRepos } = await import('./git');
    const result = await discoverGitRepos('/w');
    expect(result).toEqual([
      { path: '/w', relativePath: '', name: 'w', kind: 'root' },
      { path: '/w/api', relativePath: 'api', name: 'api', kind: 'nested' },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith('git_discover_repos', { rootPath: '/w' });
  });

  it('getGitDiffFileRef invokes git_diff_file_ref', async () => {
    mockInvoke.mockResolvedValueOnce('ref-diff');
    const { getGitDiffFileRef } = await import('./git');
    await expect(getGitDiffFileRef('/repo', 'main', 'file.md')).resolves.toBe('ref-diff');
    expect(mockInvoke).toHaveBeenCalledWith('git_diff_file_ref', {
      repoPath: '/repo',
      refName: 'main',
      filePath: 'file.md',
    });
  });
});

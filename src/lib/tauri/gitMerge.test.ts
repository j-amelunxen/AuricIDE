import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('git merge IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getMergeState passes the repo path', async () => {
    const state = {
      inProgress: true,
      operation: 'merge',
      oursLabel: 'main',
      theirsLabel: 'feature/x',
      theirsOid: 'abc',
      message: "Merge branch 'feature/x'",
      conflicts: [{ path: 'a.ts', kind: 'content' }],
    };
    mockInvoke.mockResolvedValueOnce(state);
    const { getMergeState } = await import('./gitMerge');
    expect(await getMergeState('/repo')).toEqual(state);
    expect(mockInvoke).toHaveBeenCalledWith('git_merge_state', { repoPath: '/repo' });
  });

  it('getConflictFile passes repo and file path', async () => {
    mockInvoke.mockResolvedValueOnce({ path: 'a.ts' });
    const { getConflictFile } = await import('./gitMerge');
    await getConflictFile('/repo', 'a.ts');
    expect(mockInvoke).toHaveBeenCalledWith('git_conflict_file', {
      repoPath: '/repo',
      filePath: 'a.ts',
    });
  });

  it('getConflictOrigins passes repo and file path', async () => {
    const origins = { ours: [], theirs: [{ line: 2, oid: 'abc' }], commits: [] };
    mockInvoke.mockResolvedValueOnce(origins);
    const { getConflictOrigins } = await import('./gitMerge');
    expect(await getConflictOrigins('/repo', 'a.ts')).toEqual(origins);
    expect(mockInvoke).toHaveBeenCalledWith('git_conflict_origins', {
      repoPath: '/repo',
      filePath: 'a.ts',
    });
  });

  it('resolveConflict sends content, or null to delete', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const { resolveConflict } = await import('./gitMerge');
    await resolveConflict('/repo', 'a.ts', 'text\n');
    expect(mockInvoke).toHaveBeenLastCalledWith('git_resolve_conflict', {
      repoPath: '/repo',
      filePath: 'a.ts',
      content: 'text\n',
    });
    await resolveConflict('/repo', 'a.ts', null);
    expect(mockInvoke).toHaveBeenLastCalledWith('git_resolve_conflict', {
      repoPath: '/repo',
      filePath: 'a.ts',
      content: null,
    });
  });

  it('resolveConflictSide passes the side', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const { resolveConflictSide } = await import('./gitMerge');
    await resolveConflictSide('/repo', 'img.png', 'theirs');
    expect(mockInvoke).toHaveBeenCalledWith('git_resolve_conflict_side', {
      repoPath: '/repo',
      filePath: 'img.png',
      side: 'theirs',
    });
  });

  it('abort, conclude and merge-branch use their commands', async () => {
    const { abortMerge, concludeMerge, mergeBranch } = await import('./gitMerge');
    mockInvoke.mockResolvedValueOnce(undefined);
    await abortMerge('/repo');
    expect(mockInvoke).toHaveBeenLastCalledWith('git_merge_abort', { repoPath: '/repo' });

    mockInvoke.mockResolvedValueOnce('oid1');
    expect(await concludeMerge('/repo', 'msg')).toBe('oid1');
    expect(mockInvoke).toHaveBeenLastCalledWith('git_merge_conclude', {
      repoPath: '/repo',
      message: 'msg',
    });

    const start = { outcome: 'conflicts', oid: null, conflicts: ['a.ts'] };
    mockInvoke.mockResolvedValueOnce(start);
    expect(await mergeBranch('/repo', 'feature/x')).toEqual(start);
    expect(mockInvoke).toHaveBeenLastCalledWith('git_merge_branch', {
      repoPath: '/repo',
      branch: 'feature/x',
    });
  });

  it('applyGitPatch sends a guard naming the diff the viewer showed', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const { applyGitPatch } = await import('./git');
    const guard = { filePath: 'a.ts', side: 'staged' as const, diff: 'raw' };
    await applyGitPatch('/repo', 'diff', 'index', guard);
    expect(mockInvoke).toHaveBeenCalledWith('git_apply_patch', {
      repoPath: '/repo',
      patch: 'diff',
      target: 'index',
      guard,
    });
  });

  it('applyGitPatch sends patch and target', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const { applyGitPatch } = await import('./git');
    await applyGitPatch('/repo', 'diff', 'index');
    expect(mockInvoke).toHaveBeenCalledWith('git_apply_patch', {
      repoPath: '/repo',
      patch: 'diff',
      target: 'index',
    });
  });

  it('previewMerge passes repo and branch', async () => {
    const preview = { outcome: 'conflicts', conflicts: ['a.ts'], commits: 2 };
    mockInvoke.mockResolvedValueOnce(preview);
    const { previewMerge } = await import('./gitMerge');
    expect(await previewMerge('/repo', 'feature/x')).toEqual(preview);
    expect(mockInvoke).toHaveBeenCalledWith('git_merge_preview', {
      repoPath: '/repo',
      branch: 'feature/x',
    });
  });

  it('stepOperation passes repo and action', async () => {
    const result = { outcome: 'done', operation: 'rebase', conflicts: [], message: null };
    mockInvoke.mockResolvedValueOnce(result);
    const { stepOperation } = await import('./gitMerge');
    expect(await stepOperation('/repo', 'continue')).toEqual(result);
    expect(mockInvoke).toHaveBeenCalledWith('git_operation_step', {
      repoPath: '/repo',
      action: 'continue',
    });
  });
});

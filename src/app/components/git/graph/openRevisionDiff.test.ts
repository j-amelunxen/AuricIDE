import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diffTabId } from '@/lib/git/diffTabId';
import { useStore } from '@/lib/store';
import { openRevisionDiff } from './openRevisionDiff';

const getGitDiffCommitAtParent = vi.fn();
vi.mock('@/lib/tauri/gitGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/gitGraph')>()),
  getGitDiffCommitAtParent: (...args: unknown[]) => getGitDiffCommitAtParent(...args),
}));

const OID = 'abcdef1234567890abcdef1234567890abcdef12';
const source = { kind: 'revision' as const, oid: OID, summary: 'Fix login' };

describe('openRevisionDiff', () => {
  beforeEach(() => {
    getGitDiffCommitAtParent.mockReset();
    useStore.setState({ openTabs: [], activeTabId: null, diffByTabId: {}, toasts: [] });
  });

  it('opens the same revision diff tab the file history opens', async () => {
    getGitDiffCommitAtParent.mockResolvedValue('PATCH');
    await openRevisionDiff('/work/app', { oid: OID, summary: 'Fix login' }, 'src/login.ts', 0);
    const id = diffTabId(source, 'src/login.ts', '/work/app');
    expect(getGitDiffCommitAtParent).toHaveBeenCalledWith('/work/app', OID, 'src/login.ts', 0);
    expect(useStore.getState().diffByTabId[id]).toEqual({
      patch: 'PATCH',
      filePath: 'src/login.ts',
      source,
      repoPath: '/work/app',
    });
    expect(useStore.getState().openTabs).toEqual([
      { id, path: 'src/login.ts', name: 'login.ts @ abcdef1', isDirty: false },
    ]);
    expect(useStore.getState().activeTabId).toBe(id);
  });

  it('compares against the chosen parent of a merge', async () => {
    getGitDiffCommitAtParent.mockResolvedValue('P2');
    await openRevisionDiff('/work/app', { oid: OID, summary: 'Merge' }, 'a.ts', 1);
    expect(getGitDiffCommitAtParent).toHaveBeenCalledWith('/work/app', OID, 'a.ts', 1);
  });

  it('says so instead of opening an empty tab when the diff cannot be read', async () => {
    getGitDiffCommitAtParent.mockRejectedValue(new Error('git exploded with a long stack'));
    await openRevisionDiff('/work/app', { oid: OID, summary: 'S' }, 'a.ts', 0);
    expect(useStore.getState().openTabs).toEqual([]);
    expect(useStore.getState().toasts[0]).toMatchObject({
      message: 'Could not read the change to a.ts.',
      variant: 'error',
    });
  });
});

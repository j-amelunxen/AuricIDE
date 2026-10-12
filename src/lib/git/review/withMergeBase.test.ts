import { describe, expect, it, vi } from 'vitest';
import { withMergeBase } from './withMergeBase';

const ref = { kind: 'ref' as const, repoPath: '/wt', ref: 'main' };

describe('withMergeBase', () => {
  it('pins a ref session to the merge base of the ref and HEAD', async () => {
    const getMergeBase = vi.fn(async () => 'c'.repeat(40));
    expect(await withMergeBase(ref, getMergeBase)).toEqual({
      ...ref,
      base: { kind: 'merge-base', oid: 'c'.repeat(40) },
    });
    expect(getMergeBase).toHaveBeenCalledWith('/wt', 'main', 'HEAD');
  });

  it('falls back to the tip and keeps the reason', async () => {
    const getMergeBase = vi.fn(async () => {
      throw new Error('main and HEAD have no common ancestor');
    });
    expect(await withMergeBase(ref, getMergeBase)).toEqual({
      ...ref,
      base: { kind: 'tip', reason: 'main and HEAD have no common ancestor' },
    });
  });

  it('leaves a working-tree session alone', async () => {
    const getMergeBase = vi.fn();
    const source = { kind: 'worktree' as const, repoPath: '/r' };
    expect(await withMergeBase(source, getMergeBase)).toBe(source);
    expect(getMergeBase).not.toHaveBeenCalled();
  });
});

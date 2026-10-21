import { describe, expect, it } from 'vitest';
import { diffTabId } from './diffTabId';
import { graphTabId } from './graphTabId';
import { mergeTabId } from './mergeTabId';
import { reviewTabId } from './review/reviewSession';
import { isVirtualTabId } from './virtualTabId';

describe('isVirtualTabId', () => {
  it('knows every view tab', () => {
    expect(isVirtualTabId(diffTabId({ kind: 'unstaged' }, 'a.ts', '/r'))).toBe(true);
    expect(isVirtualTabId(mergeTabId('/r', 'a.ts'))).toBe(true);
    expect(isVirtualTabId(graphTabId('/r'))).toBe(true);
    expect(isVirtualTabId(reviewTabId({ kind: 'worktree', repoPath: '/r' }))).toBe(true);
  });

  it('leaves file paths alone', () => {
    expect(isVirtualTabId('/r/notes/review.md')).toBe(false);
    expect(isVirtualTabId('/r/diff:odd-name.md')).toBe(false);
  });
});

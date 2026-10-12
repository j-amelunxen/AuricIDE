import { describe, expect, it } from 'vitest';
import { isDiffTabId } from './diffTabId';
import { isMergeTabId, mergeTabId } from './mergeTabId';

describe('mergeTabId', () => {
  it('builds a stable id from repo and file path', () => {
    expect(mergeTabId('/repo', 'src/a.ts')).toBe('merge:/repo:src/a.ts');
  });

  it('is recognised as a merge tab and never as a diff tab', () => {
    const id = mergeTabId('/repo', 'src/a.ts');
    expect(isMergeTabId(id)).toBe(true);
    expect(isDiffTabId(id)).toBe(false);
    expect(isMergeTabId('diff:unstaged:/repo:src/a.ts')).toBe(false);
    expect(isMergeTabId('/repo/merge:x')).toBe(false);
  });
});

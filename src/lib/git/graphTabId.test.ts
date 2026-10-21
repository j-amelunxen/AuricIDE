import { describe, expect, it } from 'vitest';
import { diffTabId } from './diffTabId';
import { graphTabId, isGraphTabId, repoPathFromGraphTabId } from './graphTabId';
import { mergeTabId } from './mergeTabId';

describe('graphTabId', () => {
  it('builds an id from the repo path and reads it back', () => {
    const id = graphTabId('/work/repo');
    expect(id).toBe('git-graph:/work/repo');
    expect(repoPathFromGraphTabId(id)).toBe('/work/repo');
  });

  it('keeps colons in the repo path', () => {
    expect(repoPathFromGraphTabId(graphTabId('/a:b/c'))).toBe('/a:b/c');
  });

  it('recognises only graph tabs', () => {
    expect(isGraphTabId(graphTabId('/r'))).toBe(true);
    expect(isGraphTabId(mergeTabId('/r', 'a.ts'))).toBe(false);
    expect(isGraphTabId(diffTabId({ kind: 'unstaged' }, 'a.ts', '/r'))).toBe(false);
    expect(isGraphTabId('/r/git-graph:notes.md')).toBe(false);
    expect(repoPathFromGraphTabId('/r/notes.md')).toBeNull();
  });
});

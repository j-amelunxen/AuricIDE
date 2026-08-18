import { describe, expect, it } from 'vitest';
import { diffTabId, isDiffTabId } from './diffTabId';

describe('diffTabId', () => {
  it('builds a stable unstaged id from the repo and file path', () => {
    expect(diffTabId({ kind: 'unstaged' }, 'src/a.ts', '/repo')).toBe(
      'diff:unstaged:/repo:src/a.ts'
    );
    expect(diffTabId({ kind: 'unstaged' }, 'src/a.ts', '/repo')).toBe(
      diffTabId({ kind: 'unstaged' }, 'src/a.ts', '/repo')
    );
  });

  it('builds a stable staged id', () => {
    expect(diffTabId({ kind: 'staged' }, 'src/a.ts', '/repo')).toBe('diff:staged:/repo:src/a.ts');
  });

  it('builds a stable combined id', () => {
    expect(diffTabId({ kind: 'combined' }, 'src/a.ts', '/repo')).toBe(
      'diff:combined:/repo:src/a.ts'
    );
  });

  it('embeds the full oid in a revision id', () => {
    expect(
      diffTabId({ kind: 'revision', oid: 'abcdef1234567890', summary: 'wip' }, 'src/a.ts', '/repo')
    ).toBe('diff:rev:abcdef1234567890:/repo:src/a.ts');
  });

  it('percent-encodes refs so slashes do not collide with the path', () => {
    expect(diffTabId({ kind: 'ref', ref: 'origin/main' }, 'src/a.ts', '/repo')).toBe(
      `diff:ref:${encodeURIComponent('origin/main')}:/repo:src/a.ts`
    );
    expect(diffTabId({ kind: 'ref', ref: 'origin/main' }, 'src/a.ts', '/repo')).toBe(
      'diff:ref:origin%2Fmain:/repo:src/a.ts'
    );
  });

  it('does not parse the file path out of the tab id — path is a separate argument', () => {
    const path = 'docs/foo:bar.ts';
    expect(diffTabId({ kind: 'unstaged' }, path, '/repo')).toBe(`diff:unstaged:/repo:${path}`);
  });

  it('gives two repos with the same repo-relative file two distinct ids', () => {
    const idA = diffTabId({ kind: 'unstaged' }, 'README.md', '/w/api');
    const idB = diffTabId({ kind: 'unstaged' }, 'README.md', '/w/web');
    expect(idA).not.toBe(idB);
  });
});

describe('isDiffTabId', () => {
  it('is true for every diff: prefix, including the repo-qualified ids', () => {
    expect(isDiffTabId('diff:unstaged:/repo:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:staged:/repo:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:rev:abc:/repo:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:ref:origin%2Fmain:/repo:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:/legacy/path.ts')).toBe(true);
  });

  it('is false for ordinary file tabs', () => {
    expect(isDiffTabId('/project/src/a.ts')).toBe(false);
    expect(isDiffTabId('src/a.ts')).toBe(false);
  });
});

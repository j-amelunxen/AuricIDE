import { describe, expect, it } from 'vitest';
import { diffTabId, isDiffTabId } from './diffTabId';

describe('diffTabId', () => {
  it('builds a stable unstaged id from the file path', () => {
    expect(diffTabId({ kind: 'unstaged' }, 'src/a.ts')).toBe('diff:unstaged:src/a.ts');
    expect(diffTabId({ kind: 'unstaged' }, 'src/a.ts')).toBe(
      diffTabId({ kind: 'unstaged' }, 'src/a.ts')
    );
  });

  it('builds a stable staged id', () => {
    expect(diffTabId({ kind: 'staged' }, 'src/a.ts')).toBe('diff:staged:src/a.ts');
  });

  it('builds a stable combined id', () => {
    expect(diffTabId({ kind: 'combined' }, 'src/a.ts')).toBe('diff:combined:src/a.ts');
  });

  it('embeds the full oid in a revision id', () => {
    expect(
      diffTabId({ kind: 'revision', oid: 'abcdef1234567890', summary: 'wip' }, 'src/a.ts')
    ).toBe('diff:rev:abcdef1234567890:src/a.ts');
  });

  it('percent-encodes refs so slashes do not collide with the path', () => {
    expect(diffTabId({ kind: 'ref', ref: 'origin/main' }, 'src/a.ts')).toBe(
      `diff:ref:${encodeURIComponent('origin/main')}:src/a.ts`
    );
    expect(diffTabId({ kind: 'ref', ref: 'origin/main' }, 'src/a.ts')).toBe(
      'diff:ref:origin%2Fmain:src/a.ts'
    );
  });

  it('does not parse the file path out of the tab id — path is a separate argument', () => {
    const path = 'docs/foo:bar.ts';
    expect(diffTabId({ kind: 'unstaged' }, path)).toBe(`diff:unstaged:${path}`);
  });
});

describe('isDiffTabId', () => {
  it('is true for every diff: prefix, including the new side-qualified ids', () => {
    expect(isDiffTabId('diff:unstaged:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:staged:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:rev:abc:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:ref:origin%2Fmain:src/a.ts')).toBe(true);
    expect(isDiffTabId('diff:/legacy/path.ts')).toBe(true);
  });

  it('is false for ordinary file tabs', () => {
    expect(isDiffTabId('/project/src/a.ts')).toBe(false);
    expect(isDiffTabId('src/a.ts')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { computeBacklinkWarning } from './backlinkWarning';

describe('computeBacklinkWarning', () => {
  it('returns null when nothing links to the deleted file', () => {
    const getBacklinksFor = () => [];
    expect(computeBacklinkWarning(['/p/note.md'], getBacklinksFor)).toBeNull();
  });

  it('reports a single referencing file', () => {
    const getBacklinksFor = (name: string) => (name === 'note.md' ? ['/p/other.md'] : []);
    expect(computeBacklinkWarning(['/p/note.md'], getBacklinksFor)).toBe(
      'Referenced by 1 file: other.md.'
    );
  });

  it('pluralizes and lists multiple referencing files', () => {
    const getBacklinksFor = (name: string) => (name === 'note.md' ? ['/p/a.md', '/p/b.md'] : []);
    expect(computeBacklinkWarning(['/p/note.md'], getBacklinksFor)).toBe(
      'Referenced by 2 files: a.md, b.md.'
    );
  });

  it('dedupes a file that links to more than one of the deleted paths', () => {
    const getBacklinksFor = (name: string) =>
      name === 'a.md' || name === 'b.md' ? ['/p/hub.md'] : [];
    expect(computeBacklinkWarning(['/p/a.md', '/p/b.md'], getBacklinksFor)).toBe(
      'Referenced by 1 file: hub.md.'
    );
  });

  it('excludes a referencing file that is also being deleted in the same batch', () => {
    const getBacklinksFor = (name: string) => (name === 'a.md' ? ['/p/b.md'] : []);
    expect(computeBacklinkWarning(['/p/a.md', '/p/b.md'], getBacklinksFor)).toBeNull();
  });

  it('truncates long lists to the first 5 names plus a count of the rest', () => {
    const refs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `/p/${n}.md`);
    const getBacklinksFor = (name: string) => (name === 'note.md' ? refs : []);
    expect(computeBacklinkWarning(['/p/note.md'], getBacklinksFor)).toBe(
      'Referenced by 7 files: a.md, b.md, c.md, d.md, e.md and 2 more.'
    );
  });

  it('ignores files with no basename', () => {
    const getBacklinksFor = () => [];
    expect(computeBacklinkWarning([''], getBacklinksFor)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { computeFileRenameChanges } from './renameFile';

describe('computeFileRenameChanges', () => {
  it('returns no changes when nothing links to the old name', () => {
    const files = new Map([['/p/other.md', 'no links here']]);
    expect(computeFileRenameChanges('note.md', 'notes.md', files)).toEqual([]);
  });

  it('rewrites a plain wiki-link to the new slug', () => {
    const content = 'See [[My Document]] for details.';
    const files = new Map([['/p/a.md', content]]);
    const changes = computeFileRenameChanges('my-document.md', 'my-notes.md', files);
    expect(changes).toEqual([
      {
        filePath: '/p/a.md',
        from: 4,
        to: 19,
        oldText: '[[My Document]]',
        newText: '[[my-notes]]',
      },
    ]);
  });

  it('preserves a heading fragment on the link', () => {
    const content = '[[My Document#Intro]] explains it.';
    const files = new Map([['/p/a.md', content]]);
    const changes = computeFileRenameChanges('my-document.md', 'my-notes.md', files);
    expect(changes[0].newText).toBe('[[my-notes#Intro]]');
  });

  it('matches the target case-insensitively', () => {
    const content = '[[My Document]]';
    const files = new Map([['/p/a.md', content]]);
    const changes = computeFileRenameChanges('MY-DOCUMENT.MD', 'my-notes.md', files);
    expect(changes).toHaveLength(1);
  });

  it('leaves links to a different file untouched', () => {
    const content = '[[Other Page]] and [[My Document]]';
    const files = new Map([['/p/a.md', content]]);
    const changes = computeFileRenameChanges('my-document.md', 'my-notes.md', files);
    expect(changes).toHaveLength(1);
    expect(changes[0].oldText).toBe('[[My Document]]');
  });

  it('collects changes across multiple referencing files', () => {
    const files = new Map([
      ['/p/a.md', '[[My Document]]'],
      ['/p/b.md', 'intro [[My Document]] outro'],
    ]);
    const changes = computeFileRenameChanges('my-document.md', 'my-notes.md', files);
    expect(changes.map((c) => c.filePath)).toEqual(['/p/a.md', '/p/b.md']);
  });

  it('strips the extension from the new page part regardless of old extension', () => {
    const content = '[[Note]]';
    const files = new Map([['/p/a.md', content]]);
    const changes = computeFileRenameChanges('note.md', 'note.markdown', files);
    expect(changes[0].newText).toBe('[[note]]');
  });
});

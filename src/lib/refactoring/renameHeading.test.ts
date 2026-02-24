import { describe, expect, it } from 'vitest';
import { computeHeadingRenameChanges } from './renameHeading';

describe('computeHeadingRenameChanges', () => {
  it('renames the heading in the source file', () => {
    const workspace = new Map([['/project/doc.md', '# Old Title\n\nSome content']]);

    const changes = computeHeadingRenameChanges(
      '/project/doc.md',
      'doc.md',
      'Old Title',
      'New Title',
      workspace
    );

    const sourceChanges = changes.filter((c) => c.filePath === '/project/doc.md');
    expect(sourceChanges).toHaveLength(1);
    expect(sourceChanges[0].oldText).toBe('# Old Title');
    expect(sourceChanges[0].newText).toBe('# New Title');
  });

  it('updates [[Doc#Old Title]] references in other files', () => {
    const workspace = new Map([
      ['/project/doc.md', '# Old Title\n\nContent'],
      ['/project/other.md', 'See [[Doc#Old Title]] for details'],
    ]);

    const changes = computeHeadingRenameChanges(
      '/project/doc.md',
      'doc.md',
      'Old Title',
      'New Title',
      workspace
    );

    const otherChanges = changes.filter((c) => c.filePath === '/project/other.md');
    expect(otherChanges).toHaveLength(1);
    expect(otherChanges[0].oldText).toBe('[[Doc#Old Title]]');
    expect(otherChanges[0].newText).toBe('[[Doc#New Title]]');
  });

  it('updates [[#Old Title]] current-file references', () => {
    const workspace = new Map([['/project/doc.md', '# Old Title\n\nSee [[#Old Title]] above']]);

    const changes = computeHeadingRenameChanges(
      '/project/doc.md',
      'doc.md',
      'Old Title',
      'New Title',
      workspace
    );

    const selfRefChanges = changes.filter(
      (c) => c.filePath === '/project/doc.md' && c.oldText.startsWith('[[')
    );
    expect(selfRefChanges).toHaveLength(1);
    expect(selfRefChanges[0].oldText).toBe('[[#Old Title]]');
    expect(selfRefChanges[0].newText).toBe('[[#New Title]]');
  });

  it('handles multiple references across files', () => {
    const workspace = new Map([
      ['/project/doc.md', '## Setup\n\nContent here'],
      ['/project/a.md', '[[Doc#Setup]] and more [[Doc#Setup]]'],
      ['/project/b.md', 'Also see [[Doc#Setup]]'],
    ]);

    const changes = computeHeadingRenameChanges(
      '/project/doc.md',
      'doc.md',
      'Setup',
      'Installation',
      workspace
    );

    const aChanges = changes.filter((c) => c.filePath === '/project/a.md');
    const bChanges = changes.filter((c) => c.filePath === '/project/b.md');
    expect(aChanges).toHaveLength(2);
    expect(bChanges).toHaveLength(1);
  });

  it('returns empty when no references exist', () => {
    const workspace = new Map([
      ['/project/doc.md', '# Title\n\nContent'],
      ['/project/other.md', 'No references here'],
    ]);

    const changes = computeHeadingRenameChanges(
      '/project/doc.md',
      'doc.md',
      'Title',
      'New Title',
      workspace
    );

    // Only the heading itself should change
    expect(changes).toHaveLength(1);
    expect(changes[0].filePath).toBe('/project/doc.md');
  });

  it('preserves heading level markers', () => {
    const workspace = new Map([['/project/doc.md', '### Deep Heading\n\nBody']]);

    const changes = computeHeadingRenameChanges(
      '/project/doc.md',
      'doc.md',
      'Deep Heading',
      'Renamed Heading',
      workspace
    );

    expect(changes[0].newText).toBe('### Renamed Heading');
  });

  it('matches display name case-insensitively for page part', () => {
    const workspace = new Map([
      ['/project/my-doc.md', '# Intro\n\nContent'],
      ['/project/other.md', 'See [[My Doc#Intro]] and [[my doc#Intro]]'],
    ]);

    const changes = computeHeadingRenameChanges(
      '/project/my-doc.md',
      'my-doc.md',
      'Intro',
      'Overview',
      workspace
    );

    const otherChanges = changes.filter((c) => c.filePath === '/project/other.md');
    expect(otherChanges).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';
import { applyChangesToContent, type HeadingRenameChange } from './applyRenameChanges';

describe('applyChangesToContent', () => {
  it('applies a single change', () => {
    const content = '# Old Title\n\nContent here';
    const changes: HeadingRenameChange[] = [
      { filePath: '/doc.md', from: 0, to: 11, oldText: '# Old Title', newText: '# New Title' },
    ];

    const result = applyChangesToContent(content, changes);
    expect(result).toBe('# New Title\n\nContent here');
  });

  it('applies multiple changes in same file (reverse offset order)', () => {
    const content = 'See [[Doc#Setup]] and [[Doc#Setup]] here';
    const changes: HeadingRenameChange[] = [
      {
        filePath: '/other.md',
        from: 4,
        to: 17,
        oldText: '[[Doc#Setup]]',
        newText: '[[Doc#Install]]',
      },
      {
        filePath: '/other.md',
        from: 22,
        to: 35,
        oldText: '[[Doc#Setup]]',
        newText: '[[Doc#Install]]',
      },
    ];

    const result = applyChangesToContent(content, changes);
    expect(result).toBe('See [[Doc#Install]] and [[Doc#Install]] here');
  });

  it('returns unchanged content when no changes provided', () => {
    const content = '# Title\n\nBody';
    const result = applyChangesToContent(content, []);
    expect(result).toBe(content);
  });

  it('handles adjacent changes without overlap', () => {
    const content = '[[#A]][[#B]]';
    const changes: HeadingRenameChange[] = [
      { filePath: '/doc.md', from: 0, to: 6, oldText: '[[#A]]', newText: '[[#X]]' },
      { filePath: '/doc.md', from: 6, to: 12, oldText: '[[#B]]', newText: '[[#Y]]' },
    ];

    const result = applyChangesToContent(content, changes);
    expect(result).toBe('[[#X]][[#Y]]');
  });
});

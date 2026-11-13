import { describe, expect, it } from 'vitest';
import {
  applyChangesToContent,
  describeWorkspaceFailures,
  readWorkspaceFiles,
  writeWorkspaceChanges,
  type HeadingRenameChange,
} from './applyRenameChanges';

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

describe('workspace edits', () => {
  const change = (filePath: string): HeadingRenameChange => ({
    filePath,
    from: 2,
    to: 5,
    oldText: 'Old',
    newText: 'New',
  });

  it('reports an unreadable file instead of dropping it', async () => {
    const { contents, failed } = await readWorkspaceFiles(['/a.md', '/b.md'], async (path) => {
      if (path === '/b.md') throw new Error('denied');
      return '# Old';
    });
    expect([...contents.keys()]).toEqual(['/a.md']);
    expect(failed).toEqual([{ path: '/b.md', reason: 'denied' }]);
  });

  it('writes every file it can and names the one it could not', async () => {
    const disk = new Map<string, string>();
    const contents = new Map([
      ['/a.md', '# Old'],
      ['/b.md', '# Old'],
      ['/c.md', '# Old'],
    ]);
    const { written, failed } = await writeWorkspaceChanges(
      [change('/a.md'), change('/b.md'), change('/c.md')],
      contents,
      async (path, content) => {
        if (path === '/b.md') throw new Error('read-only');
        disk.set(path, content);
      }
    );
    expect([...written.keys()]).toEqual(['/a.md', '/c.md']);
    expect(disk.get('/c.md')).toBe('# New');
    expect(failed).toEqual([{ path: '/b.md', reason: 'read-only' }]);
    expect(describeWorkspaceFailures('Renamed', failed)).toBe(
      'Renamed: one file was left unchanged (b.md).'
    );
  });

  it('says nothing when every file was written', () => {
    expect(describeWorkspaceFailures('Renamed', [])).toBeNull();
  });
});

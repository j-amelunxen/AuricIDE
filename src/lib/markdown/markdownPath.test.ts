import { describe, expect, it } from 'vitest';
import { isMarkdownPath, stripMarkdownExtension } from './markdownPath';

describe('isMarkdownPath', () => {
  it.each([
    ['/notes/a.md', true],
    ['/notes/a.markdown', true],
    ['/notes/A.MD', true],
    ['/notes/a.mdx', false],
    ['/notes/md', false],
  ])('%s → %s', (path, expected) => {
    expect(isMarkdownPath(path)).toBe(expected);
  });
});

describe('stripMarkdownExtension', () => {
  it('drops .md or .markdown in any case and leaves other names alone', () => {
    expect(stripMarkdownExtension('Notes.MD')).toBe('Notes');
    expect(stripMarkdownExtension('a.markdown')).toBe('a');
    expect(stripMarkdownExtension('diagram.canvas')).toBe('diagram.canvas');
  });
});

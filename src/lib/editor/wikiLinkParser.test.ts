import { describe, expect, it } from 'vitest';
import {
  parseWikiLinks,
  resolveWikiTarget,
  resolveFragment,
  findBacklinks,
} from './wikiLinkParser';

describe('wikiLinkParser', () => {
  describe('parseWikiLinks', () => {
    it('finds a single [[simple link]]', () => {
      const links = parseWikiLinks('Hello [[simple link]] world');
      expect(links).toHaveLength(1);
      expect(links[0]).toEqual({
        from: 6,
        to: 21,
        target: 'simple-link.md',
        display: 'simple link',
      });
    });

    it('finds multiple links in text', () => {
      const links = parseWikiLinks('See [[first link]] and [[second link]] for details');
      expect(links).toHaveLength(2);
      expect(links[0].display).toBe('first link');
      expect(links[1].display).toBe('second link');
    });

    it('returns correct from/to positions', () => {
      const text = 'abc [[link1]] def [[link2]] ghi';
      const links = parseWikiLinks(text);
      expect(links).toHaveLength(2);

      expect(links[0].from).toBe(4);
      expect(links[0].to).toBe(13);
      expect(text.slice(links[0].from, links[0].to)).toBe('[[link1]]');

      expect(links[1].from).toBe(18);
      expect(links[1].to).toBe(27);
      expect(text.slice(links[1].from, links[1].to)).toBe('[[link2]]');
    });

    it('ignores incomplete [[no closing', () => {
      const links = parseWikiLinks('Hello [[no closing bracket');
      expect(links).toHaveLength(0);
    });

    it('handles empty [[]]', () => {
      const links = parseWikiLinks('An empty [[]] link');
      expect(links).toHaveLength(1);
      expect(links[0].display).toBe('');
      expect(links[0].target).toBe('.md');
    });

    it('handles nested [[link [[inner]] rest]] by matching first complete pair', () => {
      const links = parseWikiLinks('text [[link [[inner]] rest]]');
      // Should match [[link [[inner]] as the first complete [[ ... ]] pair
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links[0].from).toBe(5);
      // The first ]] closes the outer [[, matching: [[link [[inner]]
      expect(links[0].to).toBe(21);
      expect(links[0].display).toBe('link [[inner');
    });

    it('returns empty array for text with no wiki links', () => {
      const links = parseWikiLinks('Just plain text with no links');
      expect(links).toHaveLength(0);
    });

    it('handles wiki link at start of text', () => {
      const links = parseWikiLinks('[[start]] of text');
      expect(links).toHaveLength(1);
      expect(links[0].from).toBe(0);
      expect(links[0].display).toBe('start');
    });

    it('handles wiki link at end of text', () => {
      const links = parseWikiLinks('end of [[text]]');
      expect(links).toHaveLength(1);
      expect(links[0].display).toBe('text');
      expect(links[0].to).toBe(15);
    });

    it('handles multiline text with wiki links', () => {
      const links = parseWikiLinks('line1 [[link1]]\nline2 [[link2]]');
      expect(links).toHaveLength(2);
    });
  });

  describe('resolveWikiTarget', () => {
    it('converts "My Document" to "my-document.md"', () => {
      expect(resolveWikiTarget('My Document')).toBe('my-document.md');
    });

    it('converts "folder/My Doc" to "folder/my-doc.md"', () => {
      expect(resolveWikiTarget('folder/My Doc')).toBe('folder/my-doc.md');
    });

    it('handles already-lowercase input', () => {
      expect(resolveWikiTarget('already lowercase')).toBe('already-lowercase.md');
    });

    it('preserves file extension if already present: "readme.md" stays "readme.md"', () => {
      expect(resolveWikiTarget('readme.md')).toBe('readme.md');
    });

    it('preserves non-md extensions: "notes.txt" stays "notes.txt"', () => {
      expect(resolveWikiTarget('notes.txt')).toBe('notes.txt');
    });

    it('handles path with extension: "folder/My Notes.md" stays with .md', () => {
      expect(resolveWikiTarget('folder/My Notes.md')).toBe('folder/my-notes.md');
    });

    it('trims whitespace from display text', () => {
      expect(resolveWikiTarget('  spaced out  ')).toBe('spaced-out.md');
    });
  });

  describe('fragment parsing', () => {
    it('parses [[Page#Heading]] with fragment', () => {
      const links = parseWikiLinks('See [[Page#Heading]] for info');
      expect(links).toHaveLength(1);
      expect(links[0].display).toBe('Page#Heading');
      expect(links[0].target).toBe('page.md');
      expect(links[0].fragment).toBe('Heading');
    });

    it('parses [[#Heading]] as current-file reference', () => {
      const links = parseWikiLinks('Jump to [[#Introduction]]');
      expect(links).toHaveLength(1);
      expect(links[0].display).toBe('#Introduction');
      expect(links[0].target).toBe('');
      expect(links[0].fragment).toBe('Introduction');
    });

    it('ignores empty fragment in [[Page#]]', () => {
      const links = parseWikiLinks('See [[Page#]]');
      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('page.md');
      expect(links[0].fragment).toBeUndefined();
    });

    it('uses only first # for fragment split', () => {
      const links = parseWikiLinks('See [[Page#Heading#Sub]]');
      expect(links).toHaveLength(1);
      expect(links[0].target).toBe('page.md');
      expect(links[0].fragment).toBe('Heading#Sub');
    });

    it('has no fragment for regular [[Page]] links', () => {
      const links = parseWikiLinks('See [[My Page]] here');
      expect(links).toHaveLength(1);
      expect(links[0].fragment).toBeUndefined();
    });
  });

  describe('resolveFragment', () => {
    it('splits "Page#Heading" into page and fragment', () => {
      const result = resolveFragment('Page#Heading');
      expect(result).toEqual({ pagePart: 'Page', fragment: 'Heading' });
    });

    it('splits "#Heading" into empty page and fragment', () => {
      const result = resolveFragment('#Heading');
      expect(result).toEqual({ pagePart: '', fragment: 'Heading' });
    });

    it('returns no fragment for plain "Page"', () => {
      const result = resolveFragment('Page');
      expect(result).toEqual({ pagePart: 'Page', fragment: undefined });
    });

    it('returns no fragment for "Page#" (empty after #)', () => {
      const result = resolveFragment('Page#');
      expect(result).toEqual({ pagePart: 'Page', fragment: undefined });
    });

    it('uses only first # for split', () => {
      const result = resolveFragment('Page#Heading#Sub');
      expect(result).toEqual({ pagePart: 'Page', fragment: 'Heading#Sub' });
    });
  });

  describe('findBacklinks', () => {
    it('returns files containing link to target', () => {
      const files = new Map<string, string>([
        ['notes.md', 'Check [[My Document]] for details'],
        ['todo.md', 'Remember to update [[My Document]]'],
        ['readme.md', 'No links here'],
      ]);
      const backlinks = findBacklinks(files, 'My Document');
      expect(backlinks).toEqual(['notes.md', 'todo.md']);
    });

    it('returns empty array when no backlinks exist', () => {
      const files = new Map<string, string>([
        ['notes.md', 'No links here'],
        ['readme.md', 'Just plain text'],
      ]);
      const backlinks = findBacklinks(files, 'Nonexistent');
      expect(backlinks).toHaveLength(0);
    });

    it('does not include a file that links to a different target', () => {
      const files = new Map<string, string>([['notes.md', 'Check [[Other Document]] for details']]);
      const backlinks = findBacklinks(files, 'My Document');
      expect(backlinks).toHaveLength(0);
    });

    it('handles empty files map', () => {
      const backlinks = findBacklinks(new Map(), 'Anything');
      expect(backlinks).toHaveLength(0);
    });
  });
});

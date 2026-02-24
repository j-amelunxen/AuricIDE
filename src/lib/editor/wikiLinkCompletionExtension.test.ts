import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  wikiLinkCompletionExtension,
  fileListFacet,
  headingProviderFacet,
  wikiLinkCompletion,
} from './wikiLinkCompletionExtension';
import type { HeadingRange } from '@/lib/editor/markdownHeadingParser';

type HeadingProvider = (filePath: string) => HeadingRange[];

function getCompletions(
  doc: string,
  filePaths: string[],
  pos?: number,
  headingProvider?: HeadingProvider
) {
  const extensions = [fileListFacet.of(filePaths)];
  if (headingProvider) {
    extensions.push(headingProviderFacet.of(headingProvider));
  }
  const state = EditorState.create({
    doc,
    extensions,
    selection: { anchor: pos ?? doc.length },
  });
  const ctx = new CompletionContext(state, pos ?? doc.length, false);
  return wikiLinkCompletion(ctx);
}

describe('wikiLinkCompletionExtension', () => {
  it('exports wikiLinkCompletionExtension as defined', () => {
    expect(wikiLinkCompletionExtension).toBeDefined();
  });

  it('exports fileListFacet as defined', () => {
    expect(fileListFacet).toBeDefined();
  });

  it('can be added to an EditorView without error', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const state = EditorState.create({
      doc: 'Type [[ to trigger',
      extensions: [
        wikiLinkCompletionExtension,
        fileListFacet.of(['/project/readme.md', '/project/notes.md']),
      ],
    });
    const view = new EditorView({ state, parent });
    expect(view).toBeDefined();

    view.destroy();
    document.body.removeChild(parent);
  });

  it('fileListFacet combines to first value', () => {
    const state = EditorState.create({
      doc: '',
      extensions: [fileListFacet.of(['/a.md', '/b.md'])],
    });
    expect(state.facet(fileListFacet)).toEqual(['/a.md', '/b.md']);
  });

  it('fileListFacet defaults to empty array', () => {
    const state = EditorState.create({
      doc: '',
      extensions: [],
    });
    expect(state.facet(fileListFacet)).toEqual([]);
  });

  // Completion function tests
  it('returns null when no [[ is present', () => {
    const result = getCompletions('hello world', ['/a.md']);
    expect(result).toBeNull();
  });

  it('returns completions after [[', () => {
    const result = getCompletions('some [[', ['/project/readme.md', '/project/notes.md']);
    expect(result).not.toBeNull();
    expect(result!.options.length).toBe(2);
  });

  it('returns null when [[ is already closed with ]]', () => {
    const result = getCompletions('some [[link]] more text', ['/a.md']);
    expect(result).toBeNull();
  });

  it('strips .md extension from display labels', () => {
    const result = getCompletions('[[', ['/project/readme.md']);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('readme');
  });

  it('preserves non-.md extensions in display labels', () => {
    const result = getCompletions('[[', ['/project/data.csv']);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('data.csv');
  });

  it('fuzzy-filters options by query text', () => {
    const result = getCompletions('[[read', [
      '/project/readme.md',
      '/project/notes.md',
      '/project/reading-list.md',
    ]);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('readme');
    expect(labels).toContain('reading-list');
    expect(labels).not.toContain('notes');
  });

  it('returns from position after the [[', () => {
    const doc = 'hello [[que';
    const result = getCompletions(doc, ['/a.md']);
    expect(result).not.toBeNull();
    // "hello [[" is 8 chars, so from should be 8
    expect(result!.from).toBe(8);
  });

  it('sets filter to false (fuzzysort handles filtering)', () => {
    const result = getCompletions('[[', ['/a.md']);
    expect(result).not.toBeNull();
    expect(result!.filter).toBe(false);
  });

  it('limits results to 50 entries', () => {
    const paths = Array.from({ length: 100 }, (_, i) => `/file${i}.md`);
    const result = getCompletions('[[', paths);
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeLessThanOrEqual(50);
  });

  it('handles empty file list gracefully', () => {
    const result = getCompletions('[[', []);
    expect(result).not.toBeNull();
    expect(result!.options.length).toBe(0);
  });

  it('shows detail for non-.md files (basename differs from display)', () => {
    const result = getCompletions('[[', ['/project/data.csv']);
    expect(result).not.toBeNull();
    // For non-.md, display === base, so detail should be undefined
    expect(result!.options[0].detail).toBeUndefined();
  });

  // Heading completion tests
  describe('heading completion mode', () => {
    const mockHeadings: HeadingRange[] = [
      { level: 1, from: 0, to: 20, title: 'Introduction', lineNumber: 1 },
      { level: 2, from: 21, to: 50, title: 'Getting Started', lineNumber: 3 },
      { level: 2, from: 51, to: 80, title: 'Installation', lineNumber: 5 },
    ];

    const headingProvider: HeadingProvider = (filePath: string) => {
      if (filePath === 'guide' || filePath === '/project/guide.md') {
        return mockHeadings;
      }
      return [];
    };

    it('exports headingProviderFacet', () => {
      expect(headingProviderFacet).toBeDefined();
    });

    it('returns heading completions after [[Page#', () => {
      const result = getCompletions('[[guide#', ['/project/guide.md'], 8, headingProvider);
      expect(result).not.toBeNull();
      expect(result!.options.length).toBe(3);
      const labels = result!.options.map((o) => o.label);
      expect(labels).toContain('Introduction');
      expect(labels).toContain('Getting Started');
      expect(labels).toContain('Installation');
    });

    it('returns heading completions for [[# (current file)', () => {
      const result = getCompletions('[[#', ['/project/guide.md'], 3, (filePath: string) => {
        if (filePath === '') return mockHeadings;
        return [];
      });
      expect(result).not.toBeNull();
      expect(result!.options.length).toBe(3);
    });

    it('fuzzy-filters headings by query after #', () => {
      const result = getCompletions('[[guide#Intro', ['/project/guide.md'], 13, headingProvider);
      expect(result).not.toBeNull();
      const labels = result!.options.map((o) => o.label);
      expect(labels).toContain('Introduction');
      expect(labels).not.toContain('Installation');
    });

    it('returns from position after the #', () => {
      const doc = '[[guide#Get';
      const result = getCompletions(doc, ['/project/guide.md'], 11, headingProvider);
      expect(result).not.toBeNull();
      // from should be after the # which is at position 8
      expect(result!.from).toBe(8);
    });

    it('shows heading level in detail', () => {
      const result = getCompletions('[[guide#', ['/project/guide.md'], 8, headingProvider);
      expect(result).not.toBeNull();
      const intro = result!.options.find((o) => o.label === 'Introduction');
      expect(intro).toBeDefined();
      expect(intro!.detail).toBe('H1');
    });

    it('falls back to file completion when no # present', () => {
      const result = getCompletions('[[gui', ['/project/guide.md'], 5, headingProvider);
      expect(result).not.toBeNull();
      const labels = result!.options.map((o) => o.label);
      expect(labels).toContain('guide');
    });

    it('returns empty when heading provider returns no headings', () => {
      const result = getCompletions('[[unknown#', ['/project/guide.md'], 10, headingProvider);
      expect(result).not.toBeNull();
      expect(result!.options.length).toBe(0);
    });
  });
});

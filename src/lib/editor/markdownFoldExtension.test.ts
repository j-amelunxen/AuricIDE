import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { markdownFoldExtension, getMarkdownFoldRange } from './markdownFoldExtension';

function createState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), markdownFoldExtension],
  });
}

describe('markdownFoldExtension', () => {
  it('is a valid CodeMirror extension array', () => {
    expect(Array.isArray(markdownFoldExtension)).toBe(true);
    expect(markdownFoldExtension.length).toBeGreaterThan(0);
  });

  it('creates an EditorState without errors', () => {
    const state = createState('# Hello\nWorld');
    expect(state.doc.toString()).toBe('# Hello\nWorld');
  });
});

describe('getMarkdownFoldRange', () => {
  it('returns a fold range for a heading line', () => {
    const doc = '# Heading\nContent line 1\nContent line 2\n## Subheading\nMore';
    const state = createState(doc);
    const headingLine = state.doc.line(1);

    const range = getMarkdownFoldRange(state, headingLine.from, headingLine.to);
    expect(range).not.toBeNull();
    // Fold should start after the heading line and end before the next heading at level <= 1
    expect(range!.from).toBe(headingLine.to);
    // h1 folds to EOF since there's no other h1
    expect(range!.to).toBe(doc.length);
  });

  it('folds h2 to just before the next h1', () => {
    const doc = '## Section\nContent\n# Chapter';
    const state = createState(doc);
    const line1 = state.doc.line(1);

    const range = getMarkdownFoldRange(state, line1.from, line1.to);
    expect(range).not.toBeNull();
    // h2 folds to just before "# Chapter"
    const chapterStart = doc.indexOf('# Chapter');
    expect(range!.to).toBe(chapterStart - 1);
  });

  it('folds h2 to just before the next h2', () => {
    const doc = '## A\nContent\n## B\nMore';
    const state = createState(doc);
    const line1 = state.doc.line(1);

    const range = getMarkdownFoldRange(state, line1.from, line1.to);
    expect(range).not.toBeNull();
    expect(range!.to).toBe(doc.indexOf('## B') - 1);
  });

  it('h1 folds past nested h2 to next h1 or EOF', () => {
    const doc = '# Ch1\n## Sec\nContent\n# Ch2\nMore';
    const state = createState(doc);
    const line1 = state.doc.line(1);

    const range = getMarkdownFoldRange(state, line1.from, line1.to);
    expect(range).not.toBeNull();
    expect(range!.to).toBe(doc.indexOf('# Ch2') - 1);
  });

  it('returns null for non-heading lines', () => {
    const doc = '# Heading\nNormal text\n## Sub';
    const state = createState(doc);
    const line2 = state.doc.line(2); // "Normal text"

    const range = getMarkdownFoldRange(state, line2.from, line2.to);
    expect(range).toBeNull();
  });

  it('returns null for heading with no content to fold', () => {
    const doc = '## A\n## B';
    const state = createState(doc);
    const line1 = state.doc.line(1);

    const range = getMarkdownFoldRange(state, line1.from, line1.to);
    // h2 "A" folds to just before h2 "B", but there's nothing between
    // from = end of "## A" = 4, to = start of "## B" - 1 = 4
    // When from >= to, there's nothing to fold
    expect(range).toBeNull();
  });

  it('folds last heading to EOF', () => {
    const doc = '# Only heading\nSome content\nMore content';
    const state = createState(doc);
    const line1 = state.doc.line(1);

    const range = getMarkdownFoldRange(state, line1.from, line1.to);
    expect(range).not.toBeNull();
    expect(range!.to).toBe(doc.length);
  });
});

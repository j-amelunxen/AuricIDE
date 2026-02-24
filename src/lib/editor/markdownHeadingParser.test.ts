import { describe, expect, it } from 'vitest';
import { extractHeadings, getHeadingBreadcrumbs, type HeadingRange } from './markdownHeadingParser';

describe('extractHeadings', () => {
  it('extracts a single h1 heading', () => {
    const text = '# Hello World\nSome content';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(1);
    expect(headings[0]).toEqual<HeadingRange>({
      level: 1,
      from: 0,
      to: text.length,
      title: 'Hello World',
      lineNumber: 1,
    });
  });

  it('extracts h1 through h6', () => {
    const text = ['# H1', '## H2', '### H3', '#### H4', '##### H5', '###### H6'].join('\n');
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(6);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(headings.map((h) => h.title)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  });

  it('returns correct from/to offsets for multiple headings', () => {
    const text = '# First\nContent here\n## Second\nMore content';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(2);
    // First heading ranges from start to just before second heading
    expect(headings[0].from).toBe(0);
    expect(headings[0].to).toBe(text.indexOf('## Second') - 1);
    // Second heading ranges to EOF
    expect(headings[1].from).toBe(text.indexOf('## Second'));
    expect(headings[1].to).toBe(text.length);
  });

  it('handles nested headings correctly (h2 ends before next h1)', () => {
    const text = '# Chapter\n## Section\nContent\n# Next Chapter\nMore';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(3);
    expect(headings[0].title).toBe('Chapter');
    expect(headings[1].title).toBe('Section');
    expect(headings[2].title).toBe('Next Chapter');

    // Section (h2) ends before "Next Chapter" (h1)
    expect(headings[1].to).toBe(text.indexOf('# Next Chapter') - 1);
  });

  it('skips headings inside fenced code blocks', () => {
    const text = [
      '# Real Heading',
      '```',
      '# Not a heading',
      '## Also not a heading',
      '```',
      '## Another Real Heading',
    ].join('\n');
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(2);
    expect(headings[0].title).toBe('Real Heading');
    expect(headings[1].title).toBe('Another Real Heading');
  });

  it('skips headings inside triple-backtick code blocks with language', () => {
    const text = ['# Title', '```markdown', '# Inside code block', '```', '## After Code'].join(
      '\n'
    );
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(2);
    expect(headings[0].title).toBe('Title');
    expect(headings[1].title).toBe('After Code');
  });

  it('returns empty array for empty document', () => {
    expect(extractHeadings('')).toEqual([]);
  });

  it('returns empty array for document with no headings', () => {
    const text = 'Just some text\nAnother line\n\n- list item';
    expect(extractHeadings(text)).toEqual([]);
  });

  it('returns correct line numbers (1-based)', () => {
    const text = 'Some preamble\n\n# Heading on line 3\n\n## Heading on line 5';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(2);
    expect(headings[0].lineNumber).toBe(3);
    expect(headings[1].lineNumber).toBe(5);
  });

  it('trims whitespace from heading titles', () => {
    const text = '#   Spaced Out   \nContent';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(1);
    expect(headings[0].title).toBe('Spaced Out');
  });

  it('does not treat 7+ hashes as a heading', () => {
    const text = '####### Not a heading\n# Real heading';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(1);
    expect(headings[0].title).toBe('Real heading');
  });

  it('handles a heading followed by EOF with no newline', () => {
    const text = '# Only heading';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(1);
    expect(headings[0].to).toBe(text.length);
  });

  it('handles consecutive headings at the same level', () => {
    const text = '## A\n## B\n## C';
    const headings = extractHeadings(text);

    expect(headings).toHaveLength(3);
    // Each h2 ends just before the next h2
    expect(headings[0].to).toBe(text.indexOf('## B') - 1);
    expect(headings[1].to).toBe(text.indexOf('## C') - 1);
    expect(headings[2].to).toBe(text.length);
  });
});

describe('getHeadingBreadcrumbs', () => {
  it('returns full path for cursor in nested section', () => {
    const text = '# Intro\n## Setup\n### Prerequisites\nSome content here';
    const headings = extractHeadings(text);
    // Cursor on line 4 (1-based), inside "Prerequisites" section
    const crumbs = getHeadingBreadcrumbs(headings, 4);

    expect(crumbs).toHaveLength(3);
    expect(crumbs.map((c) => c.title)).toEqual(['Intro', 'Setup', 'Prerequisites']);
  });

  it('returns empty array when cursor is before first heading', () => {
    const text = 'Preamble text\n# First Heading\nContent';
    const headings = extractHeadings(text);
    const crumbs = getHeadingBreadcrumbs(headings, 1);

    expect(crumbs).toEqual([]);
  });

  it('resets stack when a same-or-higher level heading appears', () => {
    const text = '# Chapter 1\n## Section\nContent\n# Chapter 2\nMore content';
    const headings = extractHeadings(text);
    // Cursor on line 5, inside "Chapter 2"
    const crumbs = getHeadingBreadcrumbs(headings, 5);

    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].title).toBe('Chapter 2');
  });

  it('returns single element when only one heading level exists', () => {
    const text = '## Only Section\nSome content';
    const headings = extractHeadings(text);
    const crumbs = getHeadingBreadcrumbs(headings, 2);

    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].title).toBe('Only Section');
  });

  it('returns empty array for empty headings list', () => {
    const crumbs = getHeadingBreadcrumbs([], 5);
    expect(crumbs).toEqual([]);
  });

  it('handles cursor exactly on a heading line', () => {
    const text = '# Title\n## Subtitle';
    const headings = extractHeadings(text);
    // Cursor on line 2 (the ## Subtitle line)
    const crumbs = getHeadingBreadcrumbs(headings, 2);

    expect(crumbs).toHaveLength(2);
    expect(crumbs.map((c) => c.title)).toEqual(['Title', 'Subtitle']);
  });

  it('handles deep nesting with skip levels', () => {
    const text = '# Root\n#### Deep\nContent';
    const headings = extractHeadings(text);
    const crumbs = getHeadingBreadcrumbs(headings, 3);

    expect(crumbs).toHaveLength(2);
    expect(crumbs.map((c) => c.title)).toEqual(['Root', 'Deep']);
  });
});

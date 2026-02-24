import { describe, expect, it } from 'vitest';
import { computeSectionExtraction } from './extractSection';

describe('computeSectionExtraction', () => {
  it('extracts a section with heading and body', () => {
    const content = '# Title\nSome body text\nMore body\n## Next Section\nNext body';
    const result = computeSectionExtraction(content, 1);

    expect(result).not.toBeNull();
    expect(result!.headingTitle).toBe('Title');
    expect(result!.sectionContent).toBe('# Title\nSome body text\nMore body\n');
    expect(result!.sectionFrom).toBe(0);
    expect(result!.sectionTo).toBe(content.indexOf('## Next Section'));
    expect(result!.suggestedFileName).toBe('title.md');
    expect(result!.replacementText).toBe('[[Title]]\n');
  });

  it('extracts the last section extending to EOF', () => {
    const content = '# First\nBody 1\n## Last\nBody of last section';
    const result = computeSectionExtraction(content, 3);

    expect(result).not.toBeNull();
    expect(result!.headingTitle).toBe('Last');
    expect(result!.sectionContent).toBe('## Last\nBody of last section');
    expect(result!.sectionTo).toBe(content.length);
  });

  it('extracts a mid-document section bounded by next heading', () => {
    const content = '# Intro\nIntro text\n## Middle\nMiddle text\n## End\nEnd text';
    const result = computeSectionExtraction(content, 3);

    expect(result).not.toBeNull();
    expect(result!.headingTitle).toBe('Middle');
    expect(result!.sectionContent).toBe('## Middle\nMiddle text\n');
    expect(result!.sectionFrom).toBe(content.indexOf('## Middle'));
    expect(result!.sectionTo).toBe(content.indexOf('## End'));
  });

  it('extracts when cursor is on heading line itself', () => {
    const content = '## Setup\nSetup instructions\n## Usage\nUsage info';
    const result = computeSectionExtraction(content, 1);

    expect(result).not.toBeNull();
    expect(result!.headingTitle).toBe('Setup');
    expect(result!.sectionContent).toBe('## Setup\nSetup instructions\n');
  });

  it('extracts when cursor is in body of section', () => {
    const content = '# Header\nLine 1\nLine 2\nLine 3\n## Next\nMore';
    // Cursor on line 3 (1-based), which is in the body of "Header"
    const result = computeSectionExtraction(content, 3);

    expect(result).not.toBeNull();
    expect(result!.headingTitle).toBe('Header');
  });

  it('returns null for empty document', () => {
    const result = computeSectionExtraction('', 1);
    expect(result).toBeNull();
  });

  it('returns null when cursor is before first heading', () => {
    const content = 'Some preamble\nAnother line\n# First Heading\nContent';
    const result = computeSectionExtraction(content, 1);

    expect(result).toBeNull();
  });

  it('generates slugified suggested filename', () => {
    const content = '# My Awesome Heading\nContent here';
    const result = computeSectionExtraction(content, 1);

    expect(result).not.toBeNull();
    expect(result!.suggestedFileName).toBe('my-awesome-heading.md');
  });

  it('handles special characters in heading for filename slug', () => {
    const content = "# Hello, World! It's Great\nContent";
    const result = computeSectionExtraction(content, 1);

    expect(result).not.toBeNull();
    expect(result!.suggestedFileName).toBe('hello-world-its-great.md');
  });

  it('handles heading with only one word', () => {
    const content = '# Overview\nSome text';
    const result = computeSectionExtraction(content, 1);

    expect(result).not.toBeNull();
    expect(result!.suggestedFileName).toBe('overview.md');
    expect(result!.replacementText).toBe('[[Overview]]\n');
  });

  it('returns correct offsets for section from/to', () => {
    const content = '# A\n## B\nBody\n## C\nMore';
    const result = computeSectionExtraction(content, 2);

    expect(result).not.toBeNull();
    expect(content.slice(result!.sectionFrom, result!.sectionTo)).toBe('## B\nBody\n');
  });
});

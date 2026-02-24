import { describe, expect, it, vi } from 'vitest';
import { applyExtractSection } from './applyExtractSection';
import type { ExtractSectionResult } from './extractSection';

describe('applyExtractSection', () => {
  it('creates new file with section content', async () => {
    const sourceContent =
      '# Intro\nIntro body\n## Setup\nSetup instructions here.\n## Usage\nUsage info';
    // ## Setup starts at index of '## Setup' and section extends to start of '## Usage'
    const sectionFrom = sourceContent.indexOf('## Setup');
    const sectionTo = sourceContent.indexOf('## Usage');
    const sectionContent = sourceContent.slice(sectionFrom, sectionTo);
    const extraction: ExtractSectionResult = {
      sectionContent,
      sectionFrom,
      sectionTo,
      suggestedFileName: 'setup.md',
      replacementText: '[[Setup]]\n',
      headingTitle: 'Setup',
    };

    const readFile = vi.fn().mockResolvedValue(sourceContent);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await applyExtractSection(
      '/project/docs/guide.md',
      extraction,
      'setup.md',
      readFile,
      writeFile
    );

    // New file should be written with section content
    const newFileCall = writeFile.mock.calls.find(
      (call) => call[0] === '/project/docs/setup.md'
    );
    expect(newFileCall).toBeDefined();
    expect(newFileCall![1]).toBe(sectionContent);
  });

  it('replaces section in source with wiki-link', async () => {
    const sourceContent =
      '# Intro\nIntro body\n## Setup\nSetup instructions here.\n## Usage\nUsage info';
    const sectionFrom = sourceContent.indexOf('## Setup');
    const sectionTo = sourceContent.indexOf('## Usage');
    const sectionContent = sourceContent.slice(sectionFrom, sectionTo);
    const extraction: ExtractSectionResult = {
      sectionContent,
      sectionFrom,
      sectionTo,
      suggestedFileName: 'setup.md',
      replacementText: '[[Setup]]\n',
      headingTitle: 'Setup',
    };

    const readFile = vi.fn().mockResolvedValue(sourceContent);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await applyExtractSection(
      '/project/docs/guide.md',
      extraction,
      'setup.md',
      readFile,
      writeFile
    );

    // Source file should have section replaced with wiki-link
    const sourceCall = writeFile.mock.calls.find(
      (call) => call[0] === '/project/docs/guide.md'
    );
    expect(sourceCall).toBeDefined();
    const expected =
      sourceContent.slice(0, sectionFrom) + '[[Setup]]\n' + sourceContent.slice(sectionTo);
    expect(sourceCall![1]).toBe(expected);
  });

  it('returns new file path in same directory as source', async () => {
    const sourceContent = '# Title\nBody text';
    const extraction: ExtractSectionResult = {
      sectionContent: sourceContent,
      sectionFrom: 0,
      sectionTo: sourceContent.length,
      suggestedFileName: 'title.md',
      replacementText: '[[Title]]\n',
      headingTitle: 'Title',
    };

    const readFile = vi.fn().mockResolvedValue(sourceContent);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const newPath = await applyExtractSection(
      '/workspace/notes/main.md',
      extraction,
      'title.md',
      readFile,
      writeFile
    );

    expect(newPath).toBe('/workspace/notes/title.md');
  });

  it('reads the source file', async () => {
    const sourceContent = '# Heading\nContent\n';
    const extraction: ExtractSectionResult = {
      sectionContent: sourceContent,
      sectionFrom: 0,
      sectionTo: sourceContent.length,
      suggestedFileName: 'heading.md',
      replacementText: '[[Heading]]\n',
      headingTitle: 'Heading',
    };

    const readFile = vi.fn().mockResolvedValue(sourceContent);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await applyExtractSection('/docs/file.md', extraction, 'heading.md', readFile, writeFile);

    expect(readFile).toHaveBeenCalledWith('/docs/file.md');
  });

  it('writes exactly two files', async () => {
    const sourceContent = '# A\nBody\n## B\nMore';
    const sectionFrom = 0;
    const sectionTo = sourceContent.indexOf('## B');
    const extraction: ExtractSectionResult = {
      sectionContent: sourceContent.slice(sectionFrom, sectionTo),
      sectionFrom,
      sectionTo,
      suggestedFileName: 'a.md',
      replacementText: '[[A]]\n',
      headingTitle: 'A',
    };

    const readFile = vi.fn().mockResolvedValue(sourceContent);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await applyExtractSection('/project/readme.md', extraction, 'a.md', readFile, writeFile);

    expect(writeFile).toHaveBeenCalledTimes(2);
  });
});

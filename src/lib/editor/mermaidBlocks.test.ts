import { describe, expect, it } from 'vitest';
import { extractMermaidBlocks } from './mermaidBlocks';

describe('extractMermaidBlocks', () => {
  it('extracts a single mermaid block', () => {
    const markdown = 'Some text\n```mermaid\ngraph TD\n  A-->B\n```\nMore text';
    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('graph TD\n  A-->B');
  });

  it('extracts multiple mermaid blocks', () => {
    const markdown = [
      '# Title',
      '```mermaid',
      'graph TD',
      '  A-->B',
      '```',
      'Some text in between.',
      '```mermaid',
      'sequenceDiagram',
      '  Alice->>Bob: Hello',
      '```',
    ].join('\n');

    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].code).toBe('graph TD\n  A-->B');
    expect(blocks[1].code).toBe('sequenceDiagram\n  Alice->>Bob: Hello');
  });

  it('returns correct from/to positions', () => {
    const markdown = 'Before\n```mermaid\ngraph TD\n```\nAfter';
    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);

    const expectedFrom = markdown.indexOf('```mermaid');
    const expectedTo = markdown.indexOf('```\nAfter') + 3;
    expect(blocks[0].from).toBe(expectedFrom);
    expect(blocks[0].to).toBe(expectedTo);
  });

  it('ignores non-mermaid code blocks', () => {
    const markdown = [
      '```js',
      'const x = 1;',
      '```',
      '```python',
      'print("hello")',
      '```',
      '```typescript',
      'const y: number = 2;',
      '```',
    ].join('\n');

    const blocks = extractMermaidBlocks(markdown);
    expect(blocks).toHaveLength(0);
  });

  it('returns empty array for text without mermaid blocks', () => {
    const markdown = '# Just a heading\n\nSome paragraph text.\n\n- A list item';
    const blocks = extractMermaidBlocks(markdown);
    expect(blocks).toEqual([]);
  });

  it('handles empty mermaid blocks', () => {
    const markdown = 'Text\n```mermaid\n```\nMore text';
    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('');
  });

  it('is case-insensitive for the mermaid language identifier', () => {
    const markdown = '```Mermaid\ngraph TD\n  A-->B\n```';
    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('graph TD\n  A-->B');
  });

  it('handles mermaid block at the very start of the document', () => {
    const markdown = '```mermaid\ngraph LR\n  Start-->End\n```';
    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].from).toBe(0);
    expect(blocks[0].code).toBe('graph LR\n  Start-->End');
  });

  it('handles mermaid block at the very end of the document without trailing newline', () => {
    const markdown = 'Some text\n```mermaid\ngraph TD\n  X-->Y\n```';
    const blocks = extractMermaidBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].to).toBe(markdown.length);
  });

  it('does not match partial language identifiers like mermaidx', () => {
    const markdown = '```mermaidx\ngraph TD\n  A-->B\n```';
    const blocks = extractMermaidBlocks(markdown);
    expect(blocks).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { replaceMermaidBlock } from './replaceMermaidBlock';

describe('replaceMermaidBlock', () => {
  it('replaces the content of a single mermaid block', () => {
    const md = '# Title\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nSome text';
    const result = replaceMermaidBlock(md, 'graph TD\n  A-->B', 'graph TD\n  A-->B\n  B-->C');
    expect(result).toBe('# Title\n\n```mermaid\ngraph TD\n  A-->B\n  B-->C\n```\n\nSome text');
  });

  it('replaces the correct block when there are multiple mermaid blocks', () => {
    const md = [
      '# Doc',
      '',
      '```mermaid',
      'graph TD',
      '  A-->B',
      '```',
      '',
      'Middle text',
      '',
      '```mermaid',
      'sequenceDiagram',
      '  Alice->>Bob: Hello',
      '```',
      '',
      'End text',
    ].join('\n');

    const result = replaceMermaidBlock(
      md,
      'sequenceDiagram\n  Alice->>Bob: Hello',
      'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob->>Alice: Hi'
    );

    // First block should be untouched
    expect(result).toContain('```mermaid\ngraph TD\n  A-->B\n```');
    // Second block should be updated
    expect(result).toContain(
      '```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob->>Alice: Hi\n```'
    );
    // Surrounding text preserved
    expect(result).toContain('# Doc');
    expect(result).toContain('Middle text');
    expect(result).toContain('End text');
  });

  it('returns original markdown when oldCode does not match any block', () => {
    const md = '# Title\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nSome text';
    const result = replaceMermaidBlock(md, 'graph LR\n  X-->Y', 'graph LR\n  X-->Z');
    expect(result).toBe(md);
  });

  it('preserves surrounding markdown content unchanged', () => {
    const md =
      '# Header\n\nParagraph before.\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nParagraph after.\n\n- list item';
    const result = replaceMermaidBlock(md, 'graph TD\n  A-->B', 'graph LR\n  X-->Y');
    expect(result).toBe(
      '# Header\n\nParagraph before.\n\n```mermaid\ngraph LR\n  X-->Y\n```\n\nParagraph after.\n\n- list item'
    );
  });

  it('handles whitespace differences in matching (trims both old and block code)', () => {
    const md = '```mermaid\n  graph TD\n  A-->B  \n```';
    // The code extracted will be "  graph TD\n  A-->B  "
    // We pass oldCode with different leading/trailing whitespace
    const result = replaceMermaidBlock(md, 'graph TD\n  A-->B', 'graph LR\n  X-->Y');
    expect(result).toBe('```mermaid\ngraph LR\n  X-->Y\n```');
  });

  it('works with a mermaid block at the end of the document', () => {
    const md = 'Some intro text\n\n```mermaid\ngraph TD\n  A-->B\n```';
    const result = replaceMermaidBlock(md, 'graph TD\n  A-->B', 'graph TD\n  A-->C');
    expect(result).toBe('Some intro text\n\n```mermaid\ngraph TD\n  A-->C\n```');
  });
});

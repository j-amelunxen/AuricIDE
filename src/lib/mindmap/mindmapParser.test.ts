import { describe, expect, it } from 'vitest';
import { parseMindmapMarkdown, serializeMindmap } from './mindmapParser';

describe('parseMindmapMarkdown', () => {
  it('parses H1/H2/H3 hierarchy with correct levels, contents, and edges', () => {
    const md = `# Root
## Child A
### Grandchild A1
## Child B`;

    const result = parseMindmapMarkdown(md);

    expect(result.nodes).toHaveLength(4);
    expect(result.nodes[0]).toMatchObject({ content: 'Root', level: 1 });
    expect(result.nodes[1]).toMatchObject({ content: 'Child A', level: 2 });
    expect(result.nodes[2]).toMatchObject({ content: 'Grandchild A1', level: 3 });
    expect(result.nodes[3]).toMatchObject({ content: 'Child B', level: 2 });

    expect(result.edges).toHaveLength(3);
    expect(result.edges).toContainEqual({ source: 'node-0', target: 'node-1' });
    expect(result.edges).toContainEqual({ source: 'node-1', target: 'node-2' });
    expect(result.edges).toContainEqual({ source: 'node-0', target: 'node-3' });
  });

  it('groups all content lines under a heading into a single leaf node', () => {
    const md = `# Title
Some paragraph text
Another paragraph
And one more line`;

    const result = parseMindmapMarkdown(md);

    // ONE leaf node, not three
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({ content: 'Title', level: 1 });
    expect(result.nodes[1]).toMatchObject({
      content: 'Some paragraph text\nAnother paragraph\nAnd one more line',
      level: 7,
    });
    expect(result.edges).toContainEqual({ source: 'node-0', target: 'node-1' });
  });

  it('groups list items under the same heading into one leaf', () => {
    const md = `# Shopping
- Apples
- Bananas
- Cherries`;

    const result = parseMindmapMarkdown(md);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1]).toMatchObject({
      content: '- Apples\n- Bananas\n- Cherries',
      level: 7,
    });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({ source: 'node-0', target: 'node-1' });
  });

  it('creates separate leaf nodes for content under different headings', () => {
    const md = `# Root
## Goals
Deliver on time.
## Risks
- Budget overrun
- Scope creep`;

    const result = parseMindmapMarkdown(md);

    // Root, Goals, leaf-under-Goals, Risks, leaf-under-Risks
    expect(result.nodes).toHaveLength(5);
    expect(result.nodes[2]).toMatchObject({ content: 'Deliver on time.', level: 7 });
    expect(result.nodes[4]).toMatchObject({ content: '- Budget overrun\n- Scope creep', level: 7 });
  });

  it('returns empty nodes and edges for empty string', () => {
    const result = parseMindmapMarkdown('');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('returns single node with no edges for a lone H1', () => {
    const result = parseMindmapMarkdown('# Solo Heading');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: 'node-0', content: 'Solo Heading', level: 1 });
    expect(result.edges).toEqual([]);
  });

  it('ignores empty lines within content — they do not split the leaf', () => {
    const md = `## Section
Line one

Line two`;

    const result = parseMindmapMarkdown(md);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1].content).toBe('Line one\nLine two');
  });

  it('round-trip: parse then serialize then parse preserves structure', () => {
    const md = `# Project
## Design
- Wireframes
- Mockups
## Development
### Frontend
- React components
### Backend
- API routes`;

    const first = parseMindmapMarkdown(md);
    const serialized = serializeMindmap(first);
    const second = parseMindmapMarkdown(serialized);

    expect(second.nodes).toHaveLength(first.nodes.length);
    expect(second.edges).toHaveLength(first.edges.length);

    for (let i = 0; i < first.nodes.length; i++) {
      expect(second.nodes[i].content).toBe(first.nodes[i].content);
      expect(second.nodes[i].level).toBe(first.nodes[i].level);
    }
  });

  it('layout assigns non-negative positions and siblings have different y values', () => {
    const md = `# Root
## Child A
## Child B
## Child C`;

    const result = parseMindmapMarkdown(md);

    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }

    const [, childA, childB, childC] = result.nodes;
    const yValues = new Set([childA.position.y, childB.position.y, childC.position.y]);
    expect(yValues.size).toBe(3);
  });
});

describe('serializeMindmap', () => {
  it('produces heading syntax for heading nodes', () => {
    const data = parseMindmapMarkdown(`# Title
## Subtitle
### Deep`);

    const md = serializeMindmap(data);

    expect(md).toContain('# Title');
    expect(md).toContain('## Subtitle');
    expect(md).toContain('### Deep');
  });

  it('outputs grouped leaf content as multiple lines', () => {
    const data = parseMindmapMarkdown(`# Notes
- First item
- Second item
Some paragraph`);

    const md = serializeMindmap(data);

    expect(md).toContain('- First item');
    expect(md).toContain('- Second item');
    expect(md).toContain('Some paragraph');
  });

  it('returns empty string for empty data', () => {
    const md = serializeMindmap({ nodes: [], edges: [] });
    expect(md).toBe('');
  });
});

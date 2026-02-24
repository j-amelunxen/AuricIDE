import { describe, expect, it } from 'vitest';
import { layoutLinkGraph, type LinkGraphInput } from './linkGraphLayout';

function makeInput(overrides: Partial<LinkGraphInput> = {}): LinkGraphInput {
  return {
    linkIndex: overrides.linkIndex ?? new Map(),
    brokenLinks: overrides.brokenLinks ?? new Map(),
    allFilePaths: overrides.allFilePaths ?? [],
    activeFilePath: overrides.activeFilePath ?? null,
  };
}

describe('layoutLinkGraph', () => {
  it('returns empty result for empty input', () => {
    const result = layoutLinkGraph(makeInput());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('creates a node for each file with links', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: ['b.md'], fragmentLinks: [] }],
      ['/project/b.md', { outgoingLinks: [], targets: [], fragmentLinks: [] }],
    ]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        allFilePaths: ['/project/a.md', '/project/b.md'],
      })
    );
    expect(result.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('creates edges for outgoing links', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: ['b.md'], fragmentLinks: [] }],
      ['/project/b.md', { outgoingLinks: [], targets: [], fragmentLinks: [] }],
    ]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        allFilePaths: ['/project/a.md', '/project/b.md'],
      })
    );
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    const edge = result.edges[0];
    expect(edge.source).toContain('a.md');
    expect(edge.target).toContain('b.md');
  });

  it('creates ghost nodes for broken link targets', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: ['missing.md'], fragmentLinks: [] }],
    ]);
    const brokenLinks = new Map([['/project/a.md', ['missing.md']]]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        brokenLinks,
        allFilePaths: ['/project/a.md'],
      })
    );
    const ghostNode = result.nodes.find((n) => n.data.isBroken);
    expect(ghostNode).toBeDefined();
    expect(ghostNode!.data.label).toBe('missing.md');
  });

  it('marks the active file node', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: [], fragmentLinks: [] }],
    ]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        allFilePaths: ['/project/a.md'],
        activeFilePath: '/project/a.md',
      })
    );
    const activeNode = result.nodes.find((n) => n.data.isActive);
    expect(activeNode).toBeDefined();
  });

  it('positions all nodes with non-negative coordinates', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: ['b.md'], fragmentLinks: [] }],
      ['/project/b.md', { outgoingLinks: [], targets: ['c.md'], fragmentLinks: [] }],
      ['/project/c.md', { outgoingLinks: [], targets: [], fragmentLinks: [] }],
    ]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        allFilePaths: ['/project/a.md', '/project/b.md', '/project/c.md'],
      })
    );
    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes link and backlink counts in node data', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: ['b.md'], fragmentLinks: [] }],
      ['/project/b.md', { outgoingLinks: [], targets: ['a.md'], fragmentLinks: [] }],
    ]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        allFilePaths: ['/project/a.md', '/project/b.md'],
      })
    );
    const nodeA = result.nodes.find((n) => n.data.label === 'a.md');
    expect(nodeA).toBeDefined();
    expect(nodeA!.data.linkCount).toBe(1);
    expect(nodeA!.data.backlinkCount).toBe(1);
  });

  it('does not duplicate nodes', () => {
    const linkIndex = new Map([
      ['/project/a.md', { outgoingLinks: [], targets: ['b.md', 'b.md'], fragmentLinks: [] }],
      ['/project/b.md', { outgoingLinks: [], targets: [], fragmentLinks: [] }],
    ]);
    const result = layoutLinkGraph(
      makeInput({
        linkIndex,
        allFilePaths: ['/project/a.md', '/project/b.md'],
      })
    );
    const bNodes = result.nodes.filter((n) => n.data.label === 'b.md');
    expect(bNodes).toHaveLength(1);
  });
});

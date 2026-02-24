import { describe, expect, it } from 'vitest';
import { layoutFlowchart } from './flowchartLayout';
import type { FlowchartNode, FlowchartEdge } from './mermaidFlowchartParser';

function makeNode(id: string, label?: string, shape?: FlowchartNode['shape']): FlowchartNode {
  return { id, label: label ?? id, shape: shape ?? 'default', position: { x: 0, y: 0 } };
}

function makeEdge(source: string, target: string): FlowchartEdge {
  return { source, target, style: 'arrow' };
}

describe('layoutFlowchart', () => {
  it('returns empty nodes and zero bounds for empty input', () => {
    const result = layoutFlowchart([], [], { direction: 'TD' });
    expect(result.nodes).toHaveLength(0);
    expect(result.bounds).toEqual({ width: 0, height: 0 });
  });

  it('positions a single node with positive bounds', () => {
    const nodes = [makeNode('A')];
    const result = layoutFlowchart(nodes, [], { direction: 'TD' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].position.x).toBeGreaterThanOrEqual(0);
    expect(result.nodes[0].position.y).toBeGreaterThanOrEqual(0);
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.height).toBeGreaterThan(0);
  });

  it('lays out a chain A->B->C with all positions >= 0', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const result = layoutFlowchart(nodes, edges, { direction: 'TD' });

    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.height).toBeGreaterThan(0);
  });

  it('lays out TD direction with increasing y for chain', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const result = layoutFlowchart(nodes, edges, { direction: 'TD' });

    const a = result.nodes.find((n) => n.id === 'A')!;
    const b = result.nodes.find((n) => n.id === 'B')!;
    const c = result.nodes.find((n) => n.id === 'C')!;
    expect(b.position.y).toBeGreaterThan(a.position.y);
    expect(c.position.y).toBeGreaterThan(b.position.y);
  });

  it('lays out LR direction with increasing x for chain', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const result = layoutFlowchart(nodes, edges, { direction: 'LR' });

    const a = result.nodes.find((n) => n.id === 'A')!;
    const b = result.nodes.find((n) => n.id === 'B')!;
    const c = result.nodes.find((n) => n.id === 'C')!;
    expect(b.position.x).toBeGreaterThan(a.position.x);
    expect(c.position.x).toBeGreaterThan(b.position.x);
  });

  it('lays out BT direction with decreasing y for chain', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const result = layoutFlowchart(nodes, edges, { direction: 'BT' });

    const a = result.nodes.find((n) => n.id === 'A')!;
    const c = result.nodes.find((n) => n.id === 'C')!;
    expect(a.position.y).toBeGreaterThan(c.position.y);
  });

  it('lays out RL direction with decreasing x for chain', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const result = layoutFlowchart(nodes, edges, { direction: 'RL' });

    const a = result.nodes.find((n) => n.id === 'A')!;
    const c = result.nodes.find((n) => n.id === 'C')!;
    expect(a.position.x).toBeGreaterThan(c.position.x);
  });

  it('handles diamond (rhombus) branching layout', () => {
    const nodes = [
      makeNode('A', 'Start', 'rect'),
      makeNode('B', 'Decision', 'rhombus'),
      makeNode('C', 'Yes', 'rect'),
      makeNode('D', 'No', 'rect'),
    ];
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('B', 'D')];
    const result = layoutFlowchart(nodes, edges, { direction: 'TD' });

    expect(result.nodes).toHaveLength(4);
    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles disconnected nodes', () => {
    const nodes = [makeNode('A'), makeNode('B'), makeNode('C')];
    // No edges -- all disconnected
    const result = layoutFlowchart(nodes, [], { direction: 'TD' });

    expect(result.nodes).toHaveLength(3);
    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
    }
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.height).toBeGreaterThan(0);
  });

  it('longer labels produce wider node bounds', () => {
    const short = [makeNode('A', 'Hi')];
    const long = [makeNode('A', 'This is a very long label text')];

    const shortResult = layoutFlowchart(short, [], { direction: 'TD' });
    const longResult = layoutFlowchart(long, [], { direction: 'TD' });

    expect(longResult.bounds.width).toBeGreaterThan(shortResult.bounds.width);
  });

  it('circle and rhombus shapes use fixed dimensions', () => {
    const circle = [makeNode('A', 'X', 'circle')];
    const rhombus = [makeNode('B', 'Y', 'rhombus')];

    const circleResult = layoutFlowchart(circle, [], { direction: 'TD' });
    const rhombusResult = layoutFlowchart(rhombus, [], { direction: 'TD' });

    // Both should produce valid positive bounds
    expect(circleResult.bounds.width).toBeGreaterThan(0);
    expect(rhombusResult.bounds.width).toBeGreaterThan(0);
  });

  it('treats TB the same as TD', () => {
    const nodes = [makeNode('A'), makeNode('B')];
    const edges = [makeEdge('A', 'B')];

    const tdResult = layoutFlowchart(nodes, edges, { direction: 'TD' });
    const tbResult = layoutFlowchart(
      nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
      edges,
      { direction: 'TB' }
    );

    const tdA = tdResult.nodes.find((n) => n.id === 'A')!;
    const tbA = tbResult.nodes.find((n) => n.id === 'A')!;
    expect(tdA.position.x).toBeCloseTo(tbA.position.x, 0);
    expect(tdA.position.y).toBeCloseTo(tbA.position.y, 0);
  });
});

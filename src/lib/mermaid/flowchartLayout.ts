import dagre from '@dagrejs/dagre';
import type { FlowchartNode, FlowchartEdge, FlowchartDirection } from './mermaidFlowchartParser';

export interface LayoutResult {
  nodes: FlowchartNode[];
  bounds: { width: number; height: number };
}

function directionToRankdir(direction: FlowchartDirection): string {
  switch (direction) {
    case 'TD':
    case 'TB':
      return 'TB';
    case 'LR':
      return 'LR';
    case 'BT':
      return 'BT';
    case 'RL':
      return 'RL';
    default:
      return 'TB';
  }
}

function nodeDimensions(node: FlowchartNode): { width: number; height: number } {
  if (node.shape === 'circle' || node.shape === 'double-circle') {
    return { width: 80, height: 80 };
  }
  if (node.shape === 'rhombus') {
    return { width: 80, height: 80 };
  }
  const width = Math.max(100, node.label.length * 9 + 32);
  return { width, height: 44 };
}

export function layoutFlowchart(
  nodes: FlowchartNode[],
  edges: FlowchartEdge[],
  options: { direction: FlowchartDirection }
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], bounds: { width: 0, height: 0 } };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: directionToRankdir(options.direction),
    nodesep: 60,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const dims = nodeDimensions(node);
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes: FlowchartNode[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const dims = nodeDimensions(node);
    return {
      ...node,
      position: {
        x: dagreNode.x - dims.width / 2,
        y: dagreNode.y - dims.height / 2,
      },
    };
  });

  const graphInfo = g.graph();
  const bounds = {
    width: graphInfo.width ?? 0,
    height: graphInfo.height ?? 0,
  };

  return { nodes: layoutNodes, bounds };
}

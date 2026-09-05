export type FlowchartDirection = 'TD' | 'TB' | 'LR' | 'BT' | 'RL';
export type NodeShape =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'cylindrical'
  | 'circle'
  | 'asymmetric'
  | 'rhombus'
  | 'hexagon'
  | 'double-circle'
  | 'default';
export type EdgeStyle = 'arrow' | 'open' | 'dotted' | 'thick';

export interface FlowchartNode {
  id: string;
  label: string;
  shape: NodeShape;
  position: { x: number; y: number };
}

export interface FlowchartEdge {
  source: string;
  target: string;
  label?: string;
  style: EdgeStyle;
}

export interface FlowchartSubgraph {
  id: string;
  title: string;
  nodeIds: string[];
}

export interface MermaidFlowchartData {
  direction: FlowchartDirection;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  subgraphs: FlowchartSubgraph[];
  bounds?: { width: number; height: number };
}

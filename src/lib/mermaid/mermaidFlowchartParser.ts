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

import { layoutFlowchart } from './flowchartLayout';

const DIRECTION_REGEX = /^(?:graph|flowchart)\s+(TD|TB|LR|BT|RL)/i;

/**
 * Checks whether the given code string is a Mermaid flowchart / graph.
 */
export function isMermaidFlowchart(code: string): boolean {
  if (!code.trim()) return false;
  const lines = code.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    return DIRECTION_REGEX.test(trimmed);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Node shape detection helpers
// ---------------------------------------------------------------------------

interface ParsedNodeDef {
  id: string;
  label: string;
  shape: NodeShape;
}

/**
 * Try to parse a node reference (possibly with a shape definition) from a
 * string token like `A[Label]`, `B((Circle))`, or just `C`.
 */
function parseNodeToken(token: string): ParsedNodeDef {
  // Order matters: longer / more specific delimiters first.
  const shapePatterns: Array<{ regex: RegExp; shape: NodeShape }> = [
    { regex: /^([A-Za-z_][\w-]*)\(\(\((.+)\)\)\)$/, shape: 'double-circle' },
    { regex: /^([A-Za-z_][\w-]*)\(\((.+)\)\)$/, shape: 'circle' },
    { regex: /^([A-Za-z_][\w-]*)\(\[(.+)\]\)$/, shape: 'stadium' },
    { regex: /^([A-Za-z_][\w-]*)\[\[(.+)\]\]$/, shape: 'subroutine' },
    { regex: /^([A-Za-z_][\w-]*)\[\((.+)\)\]$/, shape: 'cylindrical' },
    { regex: /^([A-Za-z_][\w-]*)\{\{(.+)\}\}$/, shape: 'hexagon' },
    { regex: /^([A-Za-z_][\w-]*)\{(.+)\}$/, shape: 'rhombus' },
    { regex: /^([A-Za-z_][\w-]*)>(.+)\]$/, shape: 'asymmetric' },
    { regex: /^([A-Za-z_][\w-]*)\[(.+)\]$/, shape: 'rect' },
    { regex: /^([A-Za-z_][\w-]*)\((.+)\)$/, shape: 'round' },
  ];

  for (const { regex, shape } of shapePatterns) {
    const m = token.match(regex);
    if (m) {
      return { id: m[1], label: m[2], shape };
    }
  }

  // Plain id (no shape definition)
  const idMatch = token.match(/^([A-Za-z_][\w-]*)$/);
  if (idMatch) {
    return { id: idMatch[1], label: idMatch[1], shape: 'default' };
  }

  // Fallback – treat entire token as id
  return { id: token, label: token, shape: 'default' };
}

// ---------------------------------------------------------------------------
// Edge pattern helpers
// ---------------------------------------------------------------------------

interface ParsedEdge {
  sourceToken: string;
  targetToken: string;
  label?: string;
  style: EdgeStyle;
}

/**
 * Attempt to parse an edge statement from a trimmed line. Returns null if the
 * line does not contain a recognisable edge.
 *
 * Supports chained edges like `A-->B-->C` by returning an array.
 */
function parseEdgesFromLine(line: string): ParsedEdge[] | null {
  // Edge patterns with optional label. We try them from most specific to least.
  // Pipe-label variants: `A-->|text|B`, `A---|text|B`, etc.
  // Inline-label variants: `A-- text -->B`, `A-. text .->B`, `A== text ==>B`

  const results: ParsedEdge[] = [];

  // Strategy: split the line by edge operators and collect edges.
  // We'll use a regex that matches known edge operators and captures the label.

  // First handle inline-label edges (e.g. `A-- text -->B`, `A-. text .->B`, `A== text ==>B`)
  const inlineArrow = /^(.+?)\s*--\s+(.+?)\s+-->\s*(.+)$/;
  const inlineDotted = /^(.+?)\s*-\.\s+(.+?)\s+\.->\s*(.+)$/;
  const inlineThick = /^(.+?)\s*==\s+(.+?)\s+==>\s*(.+)$/;

  const inlineMatch =
    line.match(inlineArrow) || line.match(inlineDotted) || line.match(inlineThick);
  if (inlineMatch) {
    const style: EdgeStyle = line.match(inlineArrow)
      ? 'arrow'
      : line.match(inlineDotted)
        ? 'dotted'
        : 'thick';
    results.push({
      sourceToken: inlineMatch[1].trim(),
      targetToken: inlineMatch[3].trim(),
      label: inlineMatch[2].trim(),
      style,
    });
    return results.length > 0 ? results : null;
  }

  // Now handle pipe-label and plain edge operators.
  // We tokenize using a regex that matches edge operators.
  // Edge operators (ordered longest first):
  //   -.-> (dotted arrow)
  //   ==> (thick arrow)
  //   --> (arrow)
  //   --- (open)

  // Pattern that captures: optional |label|, edge operator
  const edgeOpRegex = /\s*(?:-->|==>|-\.->|---)\s*(?:\|([^|]*)\|\s*)?/g;

  // We'll split the line by edge operators.
  const segments: string[] = [];
  const operators: Array<{ style: EdgeStyle; label?: string }> = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex
  edgeOpRegex.lastIndex = 0;

  while ((match = edgeOpRegex.exec(line)) !== null) {
    const segment = line.slice(lastIndex, match.index).trim();
    if (segment) segments.push(segment);

    const op = match[0].trim();
    let style: EdgeStyle = 'arrow';
    // Determine the base operator (strip label)
    const baseOp = op.replace(/\|[^|]*\|\s*$/, '').trim();
    if (baseOp === '---') style = 'open';
    else if (baseOp === '-.->') style = 'dotted';
    else if (baseOp === '==>') style = 'thick';
    else if (baseOp === '-->') style = 'arrow';

    operators.push({ style, label: match[1]?.trim() || undefined });
    lastIndex = match.index + match[0].length;
  }

  // Remaining segment after last operator
  const trailing = line.slice(lastIndex).trim();
  if (trailing) segments.push(trailing);

  if (operators.length === 0) return null;

  // Build edges from consecutive segment pairs
  for (let i = 0; i < operators.length; i++) {
    if (i < segments.length && i + 1 < segments.length) {
      results.push({
        sourceToken: segments[i],
        targetToken: segments[i + 1],
        label: operators[i].label,
        style: operators[i].style,
      });
    }
  }

  return results.length > 0 ? results : null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseMermaidFlowchart(code: string): MermaidFlowchartData {
  const nodes: FlowchartNode[] = [];
  const edges: FlowchartEdge[] = [];
  const subgraphs: FlowchartSubgraph[] = [];
  let direction: FlowchartDirection = 'TD';

  const nodeIndex = new Map<string, FlowchartNode>();

  function ensureNode(def: ParsedNodeDef): void {
    const existing = nodeIndex.get(def.id);
    if (existing) {
      // Upgrade shape/label if we now have a real definition (not default).
      if (def.shape !== 'default') {
        existing.shape = def.shape;
        existing.label = def.label;
      }
      return;
    }
    const node: FlowchartNode = {
      id: def.id,
      label: def.label,
      shape: def.shape,
      position: { x: 0, y: 0 },
    };
    nodes.push(node);
    nodeIndex.set(def.id, node);
  }

  const lines = code.split('\n');
  let subgraphCounter = 0;
  let currentSubgraph: FlowchartSubgraph | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    // Direction line
    const dirMatch = line.match(DIRECTION_REGEX);
    if (dirMatch) {
      direction = dirMatch[1].toUpperCase() as FlowchartDirection;
      continue;
    }

    // Subgraph start
    const subgraphMatch = line.match(/^subgraph\s+(.+)$/i);
    if (subgraphMatch) {
      currentSubgraph = {
        id: `sg-${subgraphCounter++}`,
        title: subgraphMatch[1].trim(),
        nodeIds: [],
      };
      subgraphs.push(currentSubgraph);
      continue;
    }

    // Subgraph end
    if (/^end$/i.test(line)) {
      currentSubgraph = null;
      continue;
    }

    // Try to parse edges from the line
    const parsedEdges = parseEdgesFromLine(line);
    if (parsedEdges) {
      for (const pe of parsedEdges) {
        const sourceDef = parseNodeToken(pe.sourceToken);
        const targetDef = parseNodeToken(pe.targetToken);
        ensureNode(sourceDef);
        ensureNode(targetDef);

        if (currentSubgraph) {
          if (!currentSubgraph.nodeIds.includes(sourceDef.id)) {
            currentSubgraph.nodeIds.push(sourceDef.id);
          }
          if (!currentSubgraph.nodeIds.includes(targetDef.id)) {
            currentSubgraph.nodeIds.push(targetDef.id);
          }
        }

        const edge: FlowchartEdge = {
          source: sourceDef.id,
          target: targetDef.id,
          style: pe.style,
        };
        if (pe.label) edge.label = pe.label;
        edges.push(edge);
      }
      continue;
    }

    // Standalone node definition (no edge)
    const nodeDef = parseNodeToken(line);
    if (nodeDef.id && nodeDef.shape !== 'default') {
      ensureNode(nodeDef);
      if (currentSubgraph && !currentSubgraph.nodeIds.includes(nodeDef.id)) {
        currentSubgraph.nodeIds.push(nodeDef.id);
      }
      continue;
    }

    // Bare id that doesn't match anything else – treat as node if it's a valid id
    if (/^[A-Za-z_][\w-]*$/.test(line)) {
      ensureNode({ id: line, label: line, shape: 'default' });
      if (currentSubgraph && !currentSubgraph.nodeIds.includes(line)) {
        currentSubgraph.nodeIds.push(line);
      }
    }
  }

  const layout = layoutFlowchart(nodes, edges, { direction });

  return { direction, nodes: layout.nodes, edges, subgraphs, bounds: layout.bounds };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeNodeDef(node: FlowchartNode): string {
  const { id, label, shape } = node;
  switch (shape) {
    case 'rect':
      return `${id}[${label}]`;
    case 'round':
      return `${id}(${label})`;
    case 'stadium':
      return `${id}([${label}])`;
    case 'subroutine':
      return `${id}[[${label}]]`;
    case 'cylindrical':
      return `${id}[(${label})]`;
    case 'circle':
      return `${id}((${label}))`;
    case 'asymmetric':
      return `${id}>${label}]`;
    case 'rhombus':
      return `${id}{${label}}`;
    case 'hexagon':
      return `${id}{{${label}}}`;
    case 'double-circle':
      return `${id}(((${label})))`;
    case 'default':
      // Only emit definition if label differs from id
      return label !== id ? `${id}[${label}]` : '';
    default:
      return `${id}[${label}]`;
  }
}

function serializeEdge(edge: FlowchartEdge): string {
  let op: string;
  switch (edge.style) {
    case 'arrow':
      op = '-->';
      break;
    case 'open':
      op = '---';
      break;
    case 'dotted':
      op = '-.->';
      break;
    case 'thick':
      op = '==>';
      break;
    default:
      op = '-->';
  }

  if (edge.label) {
    return `${edge.source} ${op}|${edge.label}| ${edge.target}`;
  }
  return `${edge.source} ${op} ${edge.target}`;
}

export function serializeMermaidFlowchart(data: MermaidFlowchartData): string {
  const lines: string[] = [];
  lines.push(`flowchart ${data.direction}`);

  const subgraphNodeIds = new Set<string>();
  for (const sg of data.subgraphs) {
    for (const nid of sg.nodeIds) {
      subgraphNodeIds.add(nid);
    }
  }

  // Emit non-subgraph node definitions
  for (const node of data.nodes) {
    if (subgraphNodeIds.has(node.id)) continue;
    const def = serializeNodeDef(node);
    if (def) lines.push(`  ${def}`);
  }

  // Emit subgraphs
  for (const sg of data.subgraphs) {
    lines.push(`  subgraph ${sg.title}`);
    for (const nid of sg.nodeIds) {
      const node = data.nodes.find((n) => n.id === nid);
      if (node) {
        const def = serializeNodeDef(node);
        if (def) lines.push(`    ${def}`);
      }
    }
    lines.push('  end');
  }

  // Emit edges
  for (const edge of data.edges) {
    lines.push(`  ${serializeEdge(edge)}`);
  }

  return lines.join('\n') + '\n';
}

export interface MindmapNode {
  id: string;
  content: string;
  level: number;
  lineStart: number;
  lineEnd: number;
  position: { x: number; y: number };
}

export interface MindmapEdge {
  source: string;
  target: string;
}

export interface MindmapData {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
}

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const X_SPACING = 250;
const Y_SPACING = 150;

function layoutNodes(nodes: MindmapNode[], edges: MindmapEdge[]): void {
  if (nodes.length === 0) return;

  const childrenMap = new Map<string, string[]>();
  const incomingSet = new Set<string>();

  for (const node of nodes) {
    childrenMap.set(node.id, []);
  }

  for (const edge of edges) {
    childrenMap.get(edge.source)!.push(edge.target);
    incomingSet.add(edge.target);
  }

  const roots = nodes.filter((n) => !incomingSet.has(n.id));
  const nodeMap = new Map<string, MindmapNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  let yCounter = 0;

  function assignPositions(nodeId: string, depth: number): void {
    const node = nodeMap.get(nodeId)!;
    const children = childrenMap.get(nodeId) ?? [];

    node.position.x = depth * X_SPACING;

    if (children.length === 0) {
      node.position.y = yCounter * Y_SPACING;
      yCounter++;
    } else {
      for (const childId of children) {
        assignPositions(childId, depth + 1);
      }
      const firstChild = nodeMap.get(children[0])!;
      const lastChild = nodeMap.get(children[children.length - 1])!;
      node.position.y = (firstChild.position.y + lastChild.position.y) / 2;
    }
  }

  for (const root of roots) {
    assignPositions(root.id, 0);
  }
}

export function parseMindmapMarkdown(content: string): MindmapData {
  const nodes: MindmapNode[] = [];
  const edges: MindmapEdge[] = [];

  if (!content.trim()) {
    return { nodes, edges };
  }

  const lines = content.split('\n');
  const parentStack: Array<{ id: string; level: number }> = [];
  let counter = 0;

  // Accumulate all non-heading content lines under the current heading
  // into a single leaf node (flushed when a new heading appears).
  let leafLines: string[] = [];
  let leafLineStart = 0;
  let leafParentId: string | null = null;

  function flushLeaf(lineEnd: number): void {
    if (leafLines.length === 0 || leafParentId === null) return;
    const id = `node-${counter++}`;
    nodes.push({
      id,
      content: leafLines.join('\n'),
      level: 7,
      lineStart: leafLineStart,
      lineEnd,
      position: { x: 0, y: 0 },
    });
    edges.push({ source: leafParentId, target: id });
    leafLines = [];
    leafParentId = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(HEADING_REGEX);

    if (headingMatch) {
      flushLeaf(i - 1);

      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = `node-${counter++}`;

      while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= level) {
        parentStack.pop();
      }

      if (parentStack.length > 0) {
        edges.push({ source: parentStack[parentStack.length - 1].id, target: id });
      }

      nodes.push({
        id,
        content: text,
        level,
        lineStart: i,
        lineEnd: i,
        position: { x: 0, y: 0 },
      });

      parentStack.push({ id, level });
    } else if (line.trim() !== '' && parentStack.length > 0) {
      // First content line under current heading: record start and parent
      if (leafLines.length === 0) {
        leafLineStart = i;
        leafParentId = parentStack[parentStack.length - 1].id;
      }
      leafLines.push(line);
    }
  }

  flushLeaf(lines.length - 1);
  layoutNodes(nodes, edges);

  return { nodes, edges };
}

export function serializeMindmap(data: MindmapData): string {
  const { nodes, edges } = data;

  if (nodes.length === 0) return '';

  const childrenMap = new Map<string, string[]>();
  const incomingSet = new Set<string>();
  const nodeMap = new Map<string, MindmapNode>();

  for (const node of nodes) {
    childrenMap.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    childrenMap.get(edge.source)!.push(edge.target);
    incomingSet.add(edge.target);
  }

  const roots = nodes.filter((n) => !incomingSet.has(n.id));
  const lines: string[] = [];

  function dfs(nodeId: string): void {
    const node = nodeMap.get(nodeId)!;
    const children = childrenMap.get(nodeId) ?? [];

    if (node.level >= 1 && node.level <= 6) {
      lines.push(`${'#'.repeat(node.level)} ${node.content}`);
    } else {
      lines.push(node.content);
    }

    for (const childId of children) {
      dfs(childId);
    }

    if (node.level >= 1 && node.level <= 6) {
      lines.push('');
    }
  }

  for (const root of roots) {
    dfs(root.id);
  }

  return lines.join('\n').trimEnd() + '\n';
}

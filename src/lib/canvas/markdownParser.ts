export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'agent' | 'script' | 'output';
  title: string;
  description: string;
  position: { x: number; y: number };
  tags?: string[];
}

export interface WorkflowEdge {
  source: string;
  target: string;
}

export interface WorkflowData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function titleToId(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '-');
}

const NODE_HEADER_RE = /^## Node:\s*(.+)$/;
const TYPE_POSITION_RE = /^<!--\s*type:\s*(\w+),\s*position:\s*(\d+),\s*(\d+)\s*-->$/;
const CONNECTS_FROM_RE = /^<!--\s*connects-from:\s*(.+?)\s*-->$/;
const TAGS_RE = /^<!--\s*tags:\s*(.+?)\s*-->$/;

export function parseWorkflowMarkdown(content: string): WorkflowData {
  const lines = content.split('\n');
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  let currentNode: Partial<WorkflowNode> | null = null;
  let currentConnections: string[] = [];
  let descriptionLines: string[] = [];

  function finalizeNode(): void {
    if (!currentNode?.title) return;

    const description = descriptionLines.join('\n').trim();

    const node: WorkflowNode = {
      id: titleToId(currentNode.title),
      type: currentNode.type ?? 'agent',
      title: currentNode.title,
      description,
      position: currentNode.position ?? { x: 0, y: 0 },
      ...(currentNode.tags ? { tags: currentNode.tags } : {}),
    };

    nodes.push(node);

    for (const sourceName of currentConnections) {
      edges.push({
        source: titleToId(sourceName),
        target: node.id,
      });
    }

    currentNode = null;
    currentConnections = [];
    descriptionLines = [];
  }

  for (const line of lines) {
    const headerMatch = line.match(NODE_HEADER_RE);
    if (headerMatch) {
      finalizeNode();
      currentNode = { title: headerMatch[1].trim() };
      continue;
    }

    if (!currentNode) continue;

    const typeMatch = line.match(TYPE_POSITION_RE);
    if (typeMatch) {
      currentNode.type = typeMatch[1] as WorkflowNode['type'];
      currentNode.position = { x: parseInt(typeMatch[2], 10), y: parseInt(typeMatch[3], 10) };
      continue;
    }

    const connectsMatch = line.match(CONNECTS_FROM_RE);
    if (connectsMatch) {
      currentConnections.push(connectsMatch[1]);
      continue;
    }

    const tagsMatch = line.match(TAGS_RE);
    if (tagsMatch) {
      currentNode.tags = tagsMatch[1].split(',').map((t) => t.trim());
      continue;
    }

    // Any other non-empty line within a node section is description
    if (line.trim() !== '') {
      descriptionLines.push(line.trim());
    }
  }

  finalizeNode();

  return { nodes, edges };
}

export function serializeWorkflow(data: WorkflowData): string {
  const lines: string[] = ['# Workflow', ''];

  for (const node of data.nodes) {
    lines.push(`## Node: ${node.title}`);
    lines.push(`<!-- type: ${node.type}, position: ${node.position.x}, ${node.position.y} -->`);

    // Add connects-from comments for edges targeting this node
    const incomingEdges = data.edges.filter((e) => e.target === node.id);
    for (const edge of incomingEdges) {
      const sourceNode = data.nodes.find((n) => n.id === edge.source);
      if (sourceNode) {
        lines.push(`<!-- connects-from: ${sourceNode.title} -->`);
      }
    }

    if (node.tags && node.tags.length > 0) {
      lines.push(`<!-- tags: ${node.tags.join(', ')} -->`);
    }

    lines.push(node.description);
    lines.push('');
  }

  return lines.join('\n');
}

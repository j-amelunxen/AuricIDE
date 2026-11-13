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

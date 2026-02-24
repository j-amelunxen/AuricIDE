import dagre from '@dagrejs/dagre';
import type { LinkIndexEntry } from '@/lib/store/wikiLinkSlice';

export interface LinkGraphNodeData {
  [key: string]: unknown;
  label: string;
  fullPath: string | null;
  isActive: boolean;
  isBroken: boolean;
  linkCount: number;
  backlinkCount: number;
}

export interface LinkGraphNode {
  id: string;
  type: 'linkGraph';
  position: { x: number; y: number };
  data: LinkGraphNodeData;
}

export interface LinkGraphEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
}

export interface LinkGraphInput {
  linkIndex: Map<string, LinkIndexEntry>;
  brokenLinks: Map<string, string[]>;
  allFilePaths: string[];
  activeFilePath: string | null;
}

export interface LinkGraphResult {
  nodes: LinkGraphNode[];
  edges: LinkGraphEdge[];
}

function basename(filePath: string): string {
  return filePath.split('/').pop()?.toLowerCase() ?? '';
}

export function layoutLinkGraph(input: LinkGraphInput): LinkGraphResult {
  const { linkIndex, brokenLinks, allFilePaths, activeFilePath } = input;

  if (linkIndex.size === 0 && allFilePaths.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Build a set of all node IDs (basenames) and map paths to basenames
  const pathToBasename = new Map<string, string>();
  const basenameToPath = new Map<string, string>();

  for (const p of allFilePaths) {
    const bn = basename(p);
    pathToBasename.set(p, bn);
    basenameToPath.set(bn, p);
  }

  // Collect all unique node IDs from files that have links or are linked to
  const nodeIds = new Set<string>();
  const ghostNodeIds = new Set<string>(); // broken targets

  // Add all files that participate in links
  for (const [filePath, entry] of linkIndex) {
    const bn = pathToBasename.get(filePath) ?? basename(filePath);
    nodeIds.add(bn);
    for (const target of entry.targets) {
      const targetLower = target.toLowerCase();
      if (basenameToPath.has(targetLower)) {
        nodeIds.add(targetLower);
      }
    }
  }

  // Add ghost nodes for broken targets
  for (const brokenTargets of brokenLinks.values()) {
    for (const target of brokenTargets) {
      const t = target.toLowerCase();
      if (!nodeIds.has(t)) {
        ghostNodeIds.add(t);
      }
    }
  }

  const allNodeIds = new Set([...nodeIds, ...ghostNodeIds]);

  if (allNodeIds.size === 0) {
    return { nodes: [], edges: [] };
  }

  // Compute backlink counts
  const backlinkCounts = new Map<string, number>();
  for (const entry of linkIndex.values()) {
    const seen = new Set<string>();
    for (const target of entry.targets) {
      const t = target.toLowerCase();
      if (!seen.has(t)) {
        seen.add(t);
        backlinkCounts.set(t, (backlinkCounts.get(t) ?? 0) + 1);
      }
    }
  }

  // Build dagre graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 80,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const nodeId of allNodeIds) {
    const width = Math.max(120, nodeId.length * 8 + 40);
    g.setNode(nodeId, { width, height: 60 });
  }

  // Build edges
  const edgeList: LinkGraphEdge[] = [];
  const edgeSet = new Set<string>();

  for (const [filePath, entry] of linkIndex) {
    const sourceId = pathToBasename.get(filePath) ?? basename(filePath);
    for (const target of entry.targets) {
      const targetId = target.toLowerCase();
      const edgeKey = `${sourceId}->${targetId}`;
      if (!edgeSet.has(edgeKey) && allNodeIds.has(targetId)) {
        edgeSet.add(edgeKey);
        g.setEdge(sourceId, targetId);
        edgeList.push({
          id: `e-${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          animated: true,
        });
      }
    }
  }

  dagre.layout(g);

  // Build positioned nodes
  const activeBasename = activeFilePath ? basename(activeFilePath) : null;

  const graphNodes: LinkGraphNode[] = [];
  for (const nodeId of allNodeIds) {
    const dagreNode = g.node(nodeId);
    const fullPath = basenameToPath.get(nodeId) ?? null;
    const filePath = [...linkIndex.keys()].find(
      (p) => (pathToBasename.get(p) ?? basename(p)) === nodeId
    );
    const entry = filePath ? linkIndex.get(filePath) : undefined;
    const linkCount = entry ? new Set(entry.targets.map((t) => t.toLowerCase())).size : 0;

    graphNodes.push({
      id: nodeId,
      type: 'linkGraph',
      position: {
        x: dagreNode.x - dagreNode.width / 2,
        y: dagreNode.y - dagreNode.height / 2,
      },
      data: {
        label: nodeId,
        fullPath,
        isActive: nodeId === activeBasename,
        isBroken: ghostNodeIds.has(nodeId),
        linkCount,
        backlinkCount: backlinkCounts.get(nodeId) ?? 0,
      },
    });
  }

  return { nodes: graphNodes, edges: edgeList };
}

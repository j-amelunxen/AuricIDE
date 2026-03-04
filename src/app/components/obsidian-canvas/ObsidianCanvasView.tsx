'use client';

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo } from 'react';
import type { ObsidianEdge, ObsidianNode, ObsidianSide } from '@/lib/obsidian-canvas/types';
import { getEdgeColor } from './nodeStyles';
import { ObsidianTextNode } from './ObsidianTextNode';
import { ObsidianFileNode } from './ObsidianFileNode';
import { ObsidianLinkNode } from './ObsidianLinkNode';
import { ObsidianGroupNode } from './ObsidianGroupNode';

const nodeTypes = {
  'obsidian-text': ObsidianTextNode,
  'obsidian-file': ObsidianFileNode,
  'obsidian-link': ObsidianLinkNode,
  'obsidian-group': ObsidianGroupNode,
};

interface ObsidianCanvasViewProps {
  nodes: ObsidianNode[];
  edges: ObsidianEdge[];
  onNodesChange: (nodes: ObsidianNode[]) => void;
  onEdgesChange: (edges: ObsidianEdge[]) => void;
  onTextEdit: (id: string, newText: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  onFileOpen?: (filePath: string) => void;
  onNodeSelect?: (id: string | null) => void;
  loadFileContent?: (relativePath: string) => Promise<string>;
  onFileDrop?: (absolutePath: string, position: { x: number; y: number }) => void;
  onNodeContextMenu?: (event: React.MouseEvent, node: { id: string }) => void;
  onTicketClick?: (ticketId: string) => void;
}

function obsidianTypeToRfType(type: ObsidianNode['type']): string {
  return `obsidian-${type}`;
}

function ObsidianCanvasViewInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onTextEdit,
  onResize,
  onFileOpen,
  onNodeSelect,
  loadFileContent,
  onFileDrop,
  onNodeContextMenu,
  onTicketClick,
}: ObsidianCanvasViewProps) {
  const { screenToFlowPosition } = useReactFlow();

  const rfNodes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: obsidianTypeToRfType(node.type),
        position: { x: node.x, y: node.y },
        style: { width: node.width, height: node.height },
        data: buildNodeData(node, onTextEdit, onResize, onFileOpen, loadFileContent, onTicketClick),
      })),
    [nodes, onTextEdit, onResize, onFileOpen, loadFileContent, onTicketClick]
  );

  const rfEdges = useMemo(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.fromNode,
        target: edge.toNode,
        ...(edge.fromSide ? { sourceHandle: edge.fromSide } : {}),
        ...(edge.toSide ? { targetHandle: edge.toSide } : {}),
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: getEdgeColor(edge.color) },
        label: edge.label,
      })),
    [edges]
  );

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const updatedRfNodes = applyNodeChanges(changes, rfNodes);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      let changed = false;
      const updatedNodes: ObsidianNode[] = updatedRfNodes.map((rn) => {
        const original = nodeMap.get(rn.id)!;
        if (original.x !== rn.position.x || original.y !== rn.position.y) {
          changed = true;
        }
        return { ...original, x: rn.position.x, y: rn.position.y };
      });

      if (changed || updatedRfNodes.length !== nodes.length) {
        onNodesChange(updatedNodes);
      }
    },
    [nodes, rfNodes, onNodesChange]
  );

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const updatedRfEdges = applyEdgeChanges(changes, rfEdges);
      const edgeMap = new Map(edges.map((e) => [e.id, e]));
      const updatedEdges: ObsidianEdge[] = updatedRfEdges
        .map((re) => edgeMap.get(re.id))
        .filter((e): e is ObsidianEdge => e !== undefined);
      if (updatedEdges.length !== edges.length) {
        onEdgesChange(updatedEdges);
      }
    },
    [edges, rfEdges, onEdgesChange]
  );

  const handleConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const newEdge: ObsidianEdge = {
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromNode: connection.source,
        toNode: connection.target,
        ...(connection.sourceHandle ? { fromSide: connection.sourceHandle as ObsidianSide } : {}),
        ...(connection.targetHandle ? { toSide: connection.targetHandle as ObsidianSide } : {}),
      };
      onEdgesChange([...edges, newEdge]);
    },
    [edges, onEdgesChange]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const filePath = e.dataTransfer.getData('text/plain');
      if (!filePath || !/\.(md|markdown)$/i.test(filePath)) return;
      if (!onFileDrop) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onFileDrop(filePath, position);
    },
    [onFileDrop, screenToFlowPosition]
  );

  return (
    <div
      className="h-full w-full"
      style={{ backgroundColor: '#0c1219' }}
      role="application"
      aria-label="Obsidian canvas editor"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_event, node) => onNodeSelect?.(node.id)}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => onNodeSelect?.(null)}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2d3d" />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export function ObsidianCanvasView(props: ObsidianCanvasViewProps) {
  return (
    <ReactFlowProvider>
      <ObsidianCanvasViewInner {...props} />
    </ReactFlowProvider>
  );
}

function buildNodeData(
  node: ObsidianNode,
  onTextEdit: (id: string, newText: string) => void,
  onResize: (id: string, width: number, height: number) => void,
  onFileOpen?: (filePath: string) => void,
  loadFileContent?: (relativePath: string) => Promise<string>,
  onTicketClick?: (ticketId: string) => void
): Record<string, unknown> {
  const color = node.color;
  const auricTicketId = node.auricTicketId;

  switch (node.type) {
    case 'text':
      return { text: node.text, color, onTextEdit, onResize, auricTicketId, onTicketClick };
    case 'file':
      return { file: node.file, color, onFileOpen, loadFileContent, auricTicketId, onTicketClick };
    case 'link':
      return { url: node.url, color };
    case 'group':
      return { label: node.label, color };
  }
}

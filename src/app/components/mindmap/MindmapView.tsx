'use client';

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type OnNodesChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MindmapNode } from './MindmapNode';
import type { MindmapEdge, MindmapNode as MindmapNodeType } from '@/lib/mindmap/mindmapParser';
import { useCallback, useMemo } from 'react';

const nodeTypes = { mindmap: MindmapNode };

interface MindmapViewProps {
  nodes: MindmapNodeType[];
  edges: MindmapEdge[];
  onNodeEdit: (id: string, newContent: string) => void;
  onNodesChange?: (nodes: MindmapNodeType[]) => void;
}

export function MindmapView({ nodes, edges, onNodeEdit, onNodesChange }: MindmapViewProps) {
  const rfNodes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'mindmap' as const,
        position: node.position,
        data: {
          content: node.content,
          level: node.level,
          onEdit: onNodeEdit,
        },
      })),
    [nodes, onNodeEdit]
  );

  const rfEdges = useMemo(
    () =>
      edges.map((edge, index) => ({
        id: `e-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        animated: true,
        style: { stroke: '#bc13fe' },
      })),
    [edges]
  );

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (!onNodesChange) return;

      const updatedRfNodes = applyNodeChanges(changes, rfNodes);

      const updatedNodes: MindmapNodeType[] = updatedRfNodes.map((rn) => {
        const original = nodes.find((n) => n.id === rn.id)!;
        return {
          ...original,
          position: rn.position,
        };
      });

      if (JSON.stringify(updatedNodes) !== JSON.stringify(nodes)) {
        onNodesChange(updatedNodes);
      }
    },
    [nodes, rfNodes, onNodesChange]
  );

  return (
    <div className="h-full w-full" style={{ backgroundColor: '#0c1219' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2d3d" />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

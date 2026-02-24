'use client';

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type OnNodesChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ProcessNode } from './ProcessNode';
import type { WorkflowEdge, WorkflowNode } from '@/lib/canvas/markdownParser';
import { useCallback, useMemo } from 'react';

const nodeTypes = { process: ProcessNode };

interface CanvasViewProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onNodesChange?: (nodes: WorkflowNode[]) => void;
  onNodeSelect?: (id: string | null) => void;
}

export function CanvasView({ nodes, edges, onNodesChange, onNodeSelect }: CanvasViewProps) {
  const rfNodes = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: 'process',
        position: node.position,
        data: {
          title: node.title,
          description: node.description,
          nodeType: node.type,
          tags: node.tags,
        },
      })),
    [nodes]
  );

  const rfEdges = useMemo(
    () =>
      edges.map((edge, index) => ({
        id: `e-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        animated: true,
        style: { stroke: '#bc13fe' }, // Auric purple for edges
      })),
    [edges]
  );

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (!onNodesChange) return;

      // Apply changes locally to find new positions
      const updatedRfNodes = applyNodeChanges(changes, rfNodes);

      // Map back to WorkflowNode structure
      const updatedNodes: WorkflowNode[] = updatedRfNodes.map((rn) => {
        const original = nodes.find((n) => n.id === rn.id)!;
        return {
          ...original,
          position: rn.position,
        };
      });

      // Only notify if there's an actual position change or similar
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
        onNodeClick={(_event, node) => onNodeSelect?.(node.id)}
        onPaneClick={() => onNodeSelect?.(null)}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2d3d" />
        <Controls />
      </ReactFlow>
    </div>
  );
}

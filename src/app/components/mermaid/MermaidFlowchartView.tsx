'use client';

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  type OnNodesChange,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodesDelete,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlowchartNode } from './FlowchartNode';
import type {
  MermaidFlowchartData,
  FlowchartEdge,
  FlowchartNode as FlowchartNodeType,
  FlowchartDirection,
  EdgeStyle,
} from '@/lib/mermaid/mermaidFlowchartParser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const nodeTypes = { flowchart: FlowchartNode };

export function generateNodeId(existingIds: Set<string>): string {
  let i = 1;
  while (existingIds.has(`node_${i}`)) {
    i++;
  }
  return `node_${i}`;
}

export function computeNewNodePosition(
  nodes: FlowchartNodeType[],
  direction: FlowchartDirection
): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };

  const isVertical = direction === 'TD' || direction === 'TB' || direction === 'BT';

  if (isVertical) {
    const maxY = Math.max(...nodes.map((n) => n.position.y));
    return { x: 100, y: maxY + 120 };
  }

  const maxX = Math.max(...nodes.map((n) => n.position.x));
  return { x: maxX + 200, y: 100 };
}

interface MermaidFlowchartViewProps {
  data: MermaidFlowchartData;
  onDataChange?: (data: MermaidFlowchartData) => void;
}

function edgeStyleProps(style: EdgeStyle) {
  const base = { stroke: '#bc13fe' };
  switch (style) {
    case 'arrow':
      return { animated: true, style: base };
    case 'open':
      return { animated: false, style: base, className: 'flowchart-edge-open' };
    case 'dotted':
      return { animated: true, style: base, className: 'flowchart-edge-dotted' };
    case 'thick':
      return { animated: true, style: base, className: 'flowchart-edge-thick' };
    default:
      return { animated: true, style: base };
  }
}

export function MermaidFlowchartView({ data, onDataChange }: MermaidFlowchartViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  const handleNodeEdit = useCallback(
    (id: string, newLabel: string) => {
      if (!onDataChange) return;
      const updatedNodes = data.nodes.map((n) => (n.id === id ? { ...n, label: newLabel } : n));
      onDataChange({ ...data, nodes: updatedNodes });
    },
    [data, onDataChange]
  );

  const rfNodes = useMemo(
    () =>
      data.nodes.map((node) => ({
        id: node.id,
        type: 'flowchart' as const,
        position: node.position,
        data: {
          label: node.label,
          shape: node.shape,
          direction: data.direction,
          onEdit: handleNodeEdit,
        },
      })),
    [data.nodes, data.direction, handleNodeEdit]
  );

  const rfEdges = useMemo(
    () =>
      data.edges.map((edge, index) => ({
        id: `e-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
        ...edgeStyleProps(edge.style),
      })),
    [data.edges]
  );

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (!onDataChange) return;

      const updatedRfNodes = applyNodeChanges(changes, rfNodes);

      const updatedNodes = updatedRfNodes.map((rn) => {
        const original = data.nodes.find((n) => n.id === rn.id)!;
        return {
          ...original,
          position: rn.position,
        };
      });

      if (JSON.stringify(updatedNodes) !== JSON.stringify(data.nodes)) {
        onDataChange({ ...data, nodes: updatedNodes });
      }
    },
    [data, rfNodes, onDataChange]
  );

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (!onDataChange) return;

      const newEdge: FlowchartEdge = {
        source: connection.source,
        target: connection.target,
        style: 'arrow',
      };

      onDataChange({ ...data, edges: [...data.edges, newEdge] });
    },
    [data, onDataChange]
  );

  const handleEdgesDelete: OnEdgesDelete = useCallback(
    (deletedEdges) => {
      if (!onDataChange) return;

      const deletedIds = new Set(deletedEdges.map((e) => e.id));
      const remainingEdges = data.edges.filter((_edge, index) => {
        const rfId = `e-${_edge.source}-${_edge.target}-${index}`;
        return !deletedIds.has(rfId);
      });

      onDataChange({ ...data, edges: remainingEdges });
    },
    [data, onDataChange]
  );

  const handleNodesDelete: OnNodesDelete = useCallback(
    (deletedNodes) => {
      if (!onDataChange) return;

      const deletedIds = new Set(deletedNodes.map((n) => n.id));
      const remainingNodes = data.nodes.filter((n) => !deletedIds.has(n.id));
      const remainingEdges = data.edges.filter(
        (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)
      );

      onDataChange({ ...data, nodes: remainingNodes, edges: remainingEdges });
    },
    [data, onDataChange]
  );

  const handleAddNode = useCallback(() => {
    if (!onDataChange) return;

    const existingIds = new Set(data.nodes.map((n) => n.id));
    const id = generateNodeId(existingIds);
    const position = computeNewNodePosition(data.nodes, data.direction);
    const newNode: FlowchartNodeType = { id, label: 'New Node', shape: 'rect', position };

    onDataChange({ ...data, nodes: [...data.nodes, newNode] });
  }, [data, onDataChange]);

  const flowProps = {
    nodes: rfNodes,
    edges: rfEdges,
    nodeTypes,
    onNodesChange: handleNodesChange,
    onConnect: handleConnect,
    onEdgesDelete: handleEdgesDelete,
    onNodesDelete: handleNodesDelete,
    fitView: true,
  };

  return (
    <>
      <div className="h-full w-full" style={{ backgroundColor: '#0c1219' }}>
        <ReactFlow {...flowProps}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2d3d" />
          <Controls />
          <MiniMap />
          <Panel position="top-right">
            <div style={{ display: 'flex', gap: '8px' }}>
              {onDataChange && (
                <button
                  className="flowchart-expand-btn"
                  onClick={handleAddNode}
                  aria-label="Add node"
                >
                  {'\u002B'} Add Node
                </button>
              )}
              <button
                className="flowchart-expand-btn"
                onClick={() => setIsFullscreen(true)}
                aria-label="Expand"
              >
                {'\u26F6'} Expand
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
      {isFullscreen &&
        createPortal(
          <div
            className="flowchart-fullscreen-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Flowchart fullscreen"
          >
            <ReactFlow {...flowProps}>
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e2d3d" />
              <Controls />
              <MiniMap />
              <Panel position="top-right">
                <div style={{ display: 'flex', gap: '8px' }}>
                  {onDataChange && (
                    <button
                      className="flowchart-expand-btn"
                      onClick={handleAddNode}
                      aria-label="Add node"
                    >
                      {'\u002B'} Add Node
                    </button>
                  )}
                  <button
                    className="flowchart-expand-btn"
                    onClick={() => setIsFullscreen(false)}
                    aria-label="Close fullscreen"
                  >
                    {'\u2715'} Close
                  </button>
                </div>
              </Panel>
            </ReactFlow>
          </div>,
          document.body
        )}
    </>
  );
}

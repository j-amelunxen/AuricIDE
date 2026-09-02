'use client';

import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
  Node,
  Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useEffect, useState, useCallback } from 'react';
import dagre from '@dagrejs/dagre';
import type { PmEpic, PmTicket, PmDependency } from '@/lib/tauri/pm';
import { EpicNode, TicketNode } from './PmNodes';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import { buildTicketStatusPriorityPowerOptions } from './ticketContextMenu';
import { calculateHeat } from '@/lib/pm/heat';
import { accentColor } from '@/lib/theme/accent';

const nodeTypes = {
  epic: EpicNode,
  ticket: TicketNode,
};

interface DependencyTreeViewProps {
  epics: PmEpic[];
  tickets: PmTicket[];
  dependencies: PmDependency[];
  onSpawnAgent?: (ticketId: string) => void;
  onSelectEpic?: (epicId: string) => void;
  onUpdateTicket?: (id: string, updates: Partial<PmTicket>) => void;
}

const nodeWidth = 200;
const nodeHeight = 80; // Increased height for custom nodes

function getLayoutedElements<T extends Node, U extends Edge>(
  nodes: T[],
  edges: U[],
  direction = 'TB'
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: direction === 'LR' ? Position.Left : Position.Top,
      sourcePosition: direction === 'LR' ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function DependencyTreeView({
  epics,
  tickets,
  dependencies,
  onSpawnAgent,
  onSelectEpic,
  onUpdateTicket,
}: DependencyTreeViewProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ticket: PmTicket } | null>(
    null
  );

  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (e, node) => {
      e.preventDefault();
      if (node.type === 'ticket') {
        const ticket = tickets.find((t) => t.id === node.id);
        if (ticket) {
          setContextMenu({ x: e.clientX, y: e.clientY, ticket });
        }
      }
    },
    [tickets]
  );

  const contextMenuOptions = useMemo<ContextMenuOption[]>(() => {
    if (!contextMenu || !onUpdateTicket) return [];
    const { ticket } = contextMenu;

    const options = buildTicketStatusPriorityPowerOptions(ticket, onUpdateTicket);

    if (onSpawnAgent) {
      options.push({ type: 'separator' });
      options.push({
        label: 'Start agent',
        icon: 'smart_toy',
        action: () => onSpawnAgent(ticket.id),
      });
    }

    return options;
  }, [contextMenu, onUpdateTicket, onSpawnAgent]);

  const initialNodes = useMemo(() => {
    const epicNodes = epics.map((epic) => ({
      id: epic.id,
      type: 'epic' as const,
      data: {
        label: epic.name,
        onSelect: onSelectEpic ? () => onSelectEpic(epic.id) : undefined,
      },
      position: { x: 0, y: 0 },
    }));

    const ticketNodes = tickets.map((ticket) => ({
      id: ticket.id,
      type: 'ticket' as const,
      data: {
        label: ticket.name,
        status: ticket.status,
        priority: ticket.priority,
        modelPower: ticket.modelPower,
        heat: calculateHeat(ticket.id, dependencies),
        onSpawnAgent: onSpawnAgent ? () => onSpawnAgent(ticket.id) : undefined,
      },
      position: { x: 0, y: 0 },
    }));

    return [...epicNodes, ...ticketNodes];
  }, [epics, tickets, dependencies, onSpawnAgent, onSelectEpic]);

  const initialEdges = useMemo(() => {
    const depEdges = dependencies.map((dep) => ({
      id: dep.id,
      source: dep.sourceId,
      target: dep.targetId,
      label: 'depends on',
      labelStyle: { fill: '#888', fontSize: 10 },
      markerEnd: { type: MarkerType.ArrowClosed, color: accentColor() },
      style: { stroke: 'var(--primary)' },
    }));

    const containmentEdges = tickets.map((ticket) => ({
      id: `contains-${ticket.epicId}-${ticket.id}`,
      source: ticket.epicId,
      target: ticket.id,
      animated: true,
      style: { stroke: 'rgba(var(--primary-rgb), 0.3)', strokeDasharray: '5,5' },
    }));

    return [...depEdges, ...containmentEdges];
  }, [dependencies, tickets]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="w-full h-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeContextMenu={handleNodeContextMenu}
        colorMode="dark"
        fitView
      >
        <Background color="#1e2d3d" gap={20} />
        <Controls />
        <Panel position="top-right" className="bg-black/50 p-2 rounded border border-white/10">
          <button
            onClick={() => {
              const { nodes: layoutedNodes } = getLayoutedElements(nodes, edges, 'TB');
              setNodes(layoutedNodes);
            }}
            className="text-xs text-white hover:text-primary transition-colors px-2 py-1"
          >
            Reset Layout
          </button>
        </Panel>
      </ReactFlow>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenuOptions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

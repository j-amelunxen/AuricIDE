'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ReactFlow, Background, BackgroundVariant, Controls, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/lib/store';
import {
  buildOrchestrationGraph,
  type OrchestrationNodeData,
} from '@/lib/orchestration/graphBuilder';
import { OrchestrationNode } from './OrchestrationNode';

const nodeTypes = { orchestration: OrchestrationNode };

/**
 * Live view of the orchestration: the goal tree, its tickets, and the agents
 * currently working on them — rendered straight from store state, so it
 * updates as agents start, stream, and finish.
 */
export function OrchestrationModal() {
  const orchestrationOpen = useStore((s) => s.orchestrationOpen);
  const setOrchestrationOpen = useStore((s) => s.setOrchestrationOpen);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const tickets = useStore((s) => s.pmDraftTickets);
  const agents = useStore((s) => s.agents);
  const goalRunsDraft = useStore((s) => s.goalRunsDraft);
  const conductorRunning = useStore((s) => s.conductorRunning);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);

  // The graph doesn't render lastActivityAt, but the agents array is replaced
  // every ~2s just to bump it — key the memo on a signature without that field
  // so streaming output doesn't rebuild the graph. Skip building entirely
  // while the modal is closed.
  const agentSignature = orchestrationOpen
    ? JSON.stringify(agents.map(({ lastActivityAt: _ignored, ...rest }) => rest))
    : '';
  const { nodes, edges } = useMemo(
    () =>
      orchestrationOpen
        ? buildOrchestrationGraph(goalsDraft, tickets, agents, goalRunsDraft)
        : { nodes: [], edges: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agents is represented by agentSignature
    [orchestrationOpen, goalsDraft, tickets, agentSignature, goalRunsDraft]
  );

  const rfEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        style: { stroke: e.animated ? '#bc13fe' : 'rgba(255,255,255,0.25)' },
      })),
    [edges]
  );

  const handleClose = useCallback(() => setOrchestrationOpen(false), [setOrchestrationOpen]);

  useEffect(() => {
    if (!orchestrationOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [orchestrationOpen, handleClose]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as OrchestrationNodeData;
      if (data.kind === 'goal') {
        setSelectedGoalId(data.entityId);
        setGoalsModalOpen(true);
        setOrchestrationOpen(false);
      }
    },
    [setSelectedGoalId, setGoalsModalOpen, setOrchestrationOpen]
  );

  if (!orchestrationOpen) return null;

  const runningAgents = agents.filter((a) => a.status === 'running').length;

  return createPortal(
    <div
      data-testid="orchestration-modal"
      className="fixed inset-0 z-[105] flex flex-col bg-black/80 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-background-dark/80 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary-light">graph_3</span>
          <h1 className="text-sm font-bold text-foreground">Orchestration</h1>
          <span className="text-[10px] text-foreground-muted">
            {goalsDraft.length} goals · {runningAgents} running agent(s)
          </span>
          {conductorRunning && (
            <span className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-bold text-green-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              conductor working
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[9px] text-foreground-muted">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-primary-light">flag</span>
              goal
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-sky-300">
                confirmation_number
              </span>
              ticket
            </span>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-green-300">
                smart_toy
              </span>
              agent
            </span>
          </div>
          <button
            data-testid="orchestration-close-btn"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="material-symbols-outlined text-4xl text-foreground-muted/30">
              graph_3
            </span>
            <p className="text-xs text-foreground-muted">Nothing to orchestrate yet.</p>
            <p className="max-w-[300px] text-[10px] text-foreground-muted/70">
              Create goals, attach tickets, and launch agents — the live graph appears here.
            </p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#ffffff12" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>,
    document.body
  );
}

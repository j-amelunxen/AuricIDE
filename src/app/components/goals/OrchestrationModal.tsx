'use client';

import { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ReactFlow, Background, BackgroundVariant, Controls, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/lib/store';
import {
  buildOrchestrationGraph,
  type OrchestrationNodeData,
} from '@/lib/orchestration/graphBuilder';
import { OrchestrationNode } from './OrchestrationNode';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

const nodeTypes = { orchestration: OrchestrationNode };

/**
 * Live view of the orchestration: the goal tree, its tickets, and the agents
 * currently working on them — rendered straight from store state, so it
 * updates as agents start, stream, and finish.
 */
export function OrchestrationModal() {
  const orchestrationOpen = useStore((s) => s.orchestrationOpen);
  if (!orchestrationOpen) return null;
  return <OrchestrationModalContent />;
}

function OrchestrationModalContent() {
  const dialogRef = useDialogA11y<HTMLDivElement>();
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
        style: { stroke: e.animated ? 'var(--primary)' : 'rgba(255,255,255,0.25)' },
      })),
    [edges]
  );

  const handleClose = useCallback(() => {
    setOrchestrationOpen(false);
    const workOpen = useStore.getState().workPlaceOpen;
    if (!workOpen) setGoalsModalOpen(true);
  }, [setOrchestrationOpen, setGoalsModalOpen]);

  useOverlayLayer({
    id: 'orchestration',
    kind: 'tool',
    active: orchestrationOpen,
    onEscape: handleClose,
  });

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as OrchestrationNodeData;
      if (data.kind === 'goal') {
        setSelectedGoalId(data.entityId);
        setOrchestrationOpen(false);
        const workOpen = useStore.getState().workPlaceOpen;
        if (workOpen) useStore.getState().setWorkTab('goals');
        else setGoalsModalOpen(true);
      }
    },
    [setSelectedGoalId, setGoalsModalOpen, setOrchestrationOpen]
  );

  const runningAgents = agents.filter((a) => a.status === 'running').length;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="orchestration-modal-title"
      data-testid="orchestration-modal"
      className="fixed inset-0 z-[var(--z-tool)] flex flex-col bg-black/80 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-background-dark/80 px-6 py-3">
        <div className="flex items-center gap-3">
          <AuricIcon name="graph_3" className="text-primary-light" />
          <h1 id="orchestration-modal-title" className="text-sm font-bold text-foreground">
            Work map
          </h1>
          <span className="text-[10px] text-foreground-muted">
            {goalsDraft.length} goals · {runningAgents} running agent(s)
          </span>
          {conductorRunning && (
            <span className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-bold text-green-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              Conductor working
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[9px] text-foreground-muted">
            <span className="flex items-center gap-1">
              <AuricIcon name="flag" className="text-[12px] text-primary-light" />
              goal
            </span>
            <span className="flex items-center gap-1">
              <AuricIcon name="confirmation_number" className="text-[12px] text-sky-300" />
              ticket
            </span>
            <span className="flex items-center gap-1">
              <AuricIcon name="smart_toy" className="text-[12px] text-green-300" />
              agent
            </span>
          </div>
          <button
            data-testid="orchestration-close-btn"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <AuricIcon name="close" className="text-base" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <AuricIcon name="graph_3" className="text-4xl text-foreground-muted/30" />
            <p className="text-xs text-foreground-muted">No work to map yet.</p>
            <p className="max-w-[300px] text-[10px] text-foreground-muted/70">
              Create goals, attach tickets, and launch agents. The live graph appears here.
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

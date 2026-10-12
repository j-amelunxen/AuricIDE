'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useConfirm, type ConfirmRequest } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import { installAgentWindowHost, type AgentWindowHostHandlers } from '@/lib/agents/agentWindowHost';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { focusMainWindow } from '@/lib/tauri/agentWindow';
import { captureAgentScreen } from './captureAgentScreen';
import { endAgentThenOfferMerge } from './endAgent';

interface AgentWindowHostBridgeProps {
  setFullscreenAgent: (agent: AgentInfo | null) => void;
}

/**
 * Carries out what the detached agent window asks of the main window
 * (`docs/design-agent-window.md`): stop, clear, save a scratch, dock back.
 * Each is the same store action the terminal modal's own controls lead to.
 * Mounted once, in the main window only.
 */
export function AgentWindowHostBridge({ setFullscreenAgent }: AgentWindowHostBridgeProps) {
  const { confirm, confirmDialog } = useConfirm();
  // The merge offer belongs to the project, so it is asked here — and the
  // user is looking at the other window when it comes up. This one comes
  // forward for the question, and only for a question.
  const confirmInFront = useCallback(
    async (request: ConfirmRequest) => {
      await focusMainWindow().catch(() => {});
      return confirm(request);
    },
    [confirm]
  );
  const offerMerge = useWorktreeMergeOffer(confirmInFront);

  // The kind is binding. "Stop this agent?" was asked — or rightly skipped —
  // for the agent as the other window saw it; if it reads differently here,
  // the answer does not cover what would happen, so nothing happens. A clear
  // must never turn into a kill nobody confirmed.
  const endAgent = useCallback(
    async (kind: 'kill' | 'dismiss', agentId: string) => {
      const store = useStore.getState();
      const target = store.agents.find((a) => a.id === agentId);
      if (!target) return;
      if (isFinishedAgent(target) !== (kind === 'dismiss')) {
        console.warn(`[agent-window] dropped ${kind} for ${agentId}: it is ${target.status} here`);
        return;
      }
      await endAgentThenOfferMerge(target, {
        onKill: store.killRunningAgent,
        onDismiss: store.dismissFinishedAgent,
        offerMerge,
      });
    },
    [offerMerge]
  );

  const dock = useCallback<AgentWindowHostHandlers['onDock']>(
    (activeAgentId, gridCells) => {
      const store = useStore.getState();
      store.setTerminalGridCells(gridCells);
      const agent = store.agents.find((a) => a.id === activeAgentId);
      // The modal shows once the window reports itself closed.
      if (agent) setFullscreenAgent(agent);
      void focusMainWindow().catch(() => {});
    },
    [setFullscreenAgent]
  );

  // The host is installed once; the handlers it routes to are read at call
  // time, so a re-render never has to tear the listeners down.
  const handlers = useRef<AgentWindowHostHandlers | null>(null);
  useEffect(() => {
    handlers.current = {
      onKill: (agentId) => endAgent('kill', agentId),
      onDismiss: (agentId) => endAgent('dismiss', agentId),
      onSaveScratch: (agentName, screen) => captureAgentScreen(agentName, () => screen),
      onDock: dock,
    };
  }, [dock, endAgent]);
  useEffect(
    () =>
      installAgentWindowHost({
        onKill: (agentId) => handlers.current?.onKill(agentId),
        onDismiss: (agentId) => handlers.current?.onDismiss(agentId),
        onSaveScratch: (agentName, screen) => handlers.current?.onSaveScratch(agentName, screen),
        onDock: (activeAgentId, gridCells) => handlers.current?.onDock(activeAgentId, gridCells),
      }),
    []
  );

  // An agent that was open in the modal when the terminals were detached must
  // not come back by itself when the agent window closes: closing that window
  // changes nothing here. Docking sets it again, after this has run.
  const agentWindowOpen = useStore((s) => s.agentWindowOpen);
  useEffect(() => {
    if (agentWindowOpen) setFullscreenAgent(null);
  }, [agentWindowOpen, setFullscreenAgent]);

  return confirmDialog;
}

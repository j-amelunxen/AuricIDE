'use client';

import { useCallback, useMemo } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { deriveErrorDigest } from '@/lib/agents/errorDigest';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import { setAgentWindowHandover } from '@/lib/agents/agentWindowHost';
import { openAgentWindow } from '@/lib/tauri/agentWindow';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AgentTerminalWorkspace } from './AgentTerminalWorkspace';
import { captureAgentScreen } from './captureAgentScreen';
import { canEndAgent, endAgentThenOfferMerge } from './endAgent';

export { AgentXterm } from './AgentXterm';

const EMPTY_ERROR_LOGS: string[] = [];
const TITLE_ID = 'agent-terminal-modal-title';

export interface AgentTerminalModalProps {
  agent: AgentInfo | null;
  /** All active agents — when provided, the modal shows a tab per agent for fast switching. */
  agents?: AgentInfo[];
  onSwitchAgent?: (agent: AgentInfo) => void;
  onClose: () => void;
  onSelectionSpawn?: (selection: string) => void;
  /** Stop a still-running (or queued) agent. Ending work asks first. */
  onKill?: (agentId: string) => void;
  /** Clear a stopped agent out of the tab strip. No prompt — nothing left to lose. */
  onDismiss?: (agentId: string) => void;
}

export function AgentTerminalModal({
  agent,
  agents,
  onSwitchAgent,
  onClose,
  onSelectionSpawn,
  onKill,
  onDismiss,
}: AgentTerminalModalProps) {
  if (!agent) return null;
  // The opened agent is a snapshot; the agents list carries live status updates.
  const liveAgent = agents?.find((a) => a.id === agent.id) ?? agent;
  return (
    <AgentTerminalDialog
      agent={liveAgent}
      agents={agents}
      onSwitchAgent={onSwitchAgent}
      onClose={onClose}
      onSelectionSpawn={onSelectionSpawn}
      onKill={onKill}
      onDismiss={onDismiss}
    />
  );
}

interface AgentTerminalDialogProps {
  agent: AgentInfo;
  agents?: AgentInfo[];
  onSwitchAgent?: (agent: AgentInfo) => void;
  onClose: () => void;
  onSelectionSpawn?: (selection: string) => void;
  onKill?: (agentId: string) => void;
  onDismiss?: (agentId: string) => void;
}

/**
 * Moves the terminals into a window of their own. The layout is left for that
 * window to pick up before it opens; the modal only goes away once the window
 * is really there, so a failed open leaves the terminals where they were.
 */
function PopOutButton({ agentId, onOpened }: { agentId: string; onOpened: () => void }) {
  const popOut = useCallback(async () => {
    setAgentWindowHandover({
      activeAgentId: agentId,
      gridCells: useStore.getState().terminalGridCells,
    });
    try {
      await openAgentWindow();
    } catch {
      // Nothing opened, so nothing may pick this layout up later.
      setAgentWindowHandover({ activeAgentId: null, gridCells: null });
      useStore.getState().showToast('Could not open the agent window', 'error');
      return;
    }
    onOpened();
  }, [agentId, onOpened]);

  return (
    <button
      onClick={() => void popOut()}
      title="Open in own window"
      aria-label="Open in own window"
      className="rounded-lg p-2 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
    >
      <AuricIcon name="open_in_new" className="text-lg" />
    </button>
  );
}

/** The modal shell: backdrop, dialog semantics and Escape, plus everything the workspace needs from the open project. */
function AgentTerminalDialog({
  agent,
  agents,
  onSwitchAgent,
  onClose,
  onSelectionSpawn,
  onKill,
  onDismiss,
}: AgentTerminalDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const { confirm, confirmDialog } = useConfirm();
  const offerMerge = useWorktreeMergeOffer(confirm);
  useOverlayLayer({ id: 'agent-terminal', kind: 'tool', active: true, onEscape: onClose });

  const canEnd = useCallback(
    (target: AgentInfo) => canEndAgent(target, { onKill, onDismiss }),
    [onDismiss, onKill]
  );
  const endAgent = useCallback(
    (target: AgentInfo) => endAgentThenOfferMerge(target, { onKill, onDismiss, offerMerge }),
    [offerMerge, onDismiss, onKill]
  );

  // Opening a failed agent should answer "why" before any scrollback hunting
  // — the same digest the review row shows, pinned above the terminal.
  const isError = agent.status === 'error';
  const errorLogs = useStore(
    useCallback(
      (s) => (isError ? (s.agentLogs[agent.id] ?? EMPTY_ERROR_LOGS) : EMPTY_ERROR_LOGS),
      [agent.id, isError]
    )
  );
  const errorDigest = useMemo(
    () => (isError ? deriveErrorDigest(errorLogs) : null),
    [isError, errorLogs]
  );

  return (
    <div
      data-testid="agent-modal-backdrop"
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="flex flex-col w-[95vw] h-[90vh] rounded-xl border border-white/10 bg-[#050510] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <AgentTerminalWorkspace
          agent={agent}
          agents={agents}
          onSwitchAgent={onSwitchAgent}
          onClose={onClose}
          onSelectionSpawn={onSelectionSpawn}
          confirm={confirm}
          onEndAgent={endAgent}
          canEndAgent={canEnd}
          onSaveScreen={captureAgentScreen}
          errorDigest={errorDigest}
          titleId={TITLE_ID}
          headerActions={<PopOutButton agentId={agent.id} onOpened={onClose} />}
        />
      </div>
      {confirmDialog}
    </div>
  );
}

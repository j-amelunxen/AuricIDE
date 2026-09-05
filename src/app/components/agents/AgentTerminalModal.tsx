'use client';

import { useCallback, useMemo } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { deriveErrorDigest } from '@/lib/agents/errorDigest';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import { isAgentLive } from '@/lib/agents/liveness';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { agentState, AGENT_STATE_LABEL } from '@/lib/agents/state';
import { groupAgentTabs } from '@/lib/agents/tabGroups';
import { UNGROUPED_REPO_KEY } from '@/lib/store/agentSlice';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ComboProgressBadge } from './ComboProgressBadge';
import { AgentTab } from './AgentTab';
import { AgentXterm } from './AgentXterm';

export { AgentXterm } from './AgentXterm';

const EMPTY_ERROR_LOGS: string[] = [];

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
 * The tab to land on after one is closed — the next one, or the previous at
 * the end. Takes the agents in the order the strip draws them, not the order
 * the fleet arrives in.
 */
function neighborAfterClose(agents: AgentInfo[], closingId: string): AgentInfo | null {
  const idx = agents.findIndex((a) => a.id === closingId);
  const remaining = agents.filter((a) => a.id !== closingId);
  if (remaining.length === 0) return null;
  if (idx < 0) return remaining[0];
  return remaining[Math.min(idx, remaining.length - 1)];
}

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

  // One project is not a grouping: with the whole fleet in one repository the
  // heading says nothing every tab does not already imply, so it stays away.
  const tabGroups = useMemo(() => groupAgentTabs(agents ?? []), [agents]);
  const showTabGroupLabels = tabGroups.length > 1;
  // Grouping reorders the strip, so "the tab beside this one" has to be read
  // off the strip — the raw list would send the user to another project.
  const tabOrder = useMemo(() => tabGroups.flatMap((group) => group.agents), [tabGroups]);

  const closeTab = useCallback(
    async (target: AgentInfo) => {
      const finished = isFinishedAgent(target);
      if (finished ? !onDismiss : !onKill) return;

      if (!finished && target.status === 'running') {
        const go = await confirm({
          title: 'Stop this agent?',
          message: `Stop ${target.name}? Its work in progress is lost.`,
          confirmLabel: 'Stop',
        });
        if (!go) return;
      }

      // Leave the dying tab before the process dies, so the screen does not
      // sit on a snapshot of an agent that is already gone.
      if (target.id === agent.id) {
        const next = neighborAfterClose(tabOrder, target.id);
        if (next) onSwitchAgent?.(next);
        else onClose();
      }

      if (finished) onDismiss?.(target.id);
      else await Promise.resolve(onKill?.(target.id));
      await offerMerge(target);
    },
    [agent.id, tabOrder, confirm, offerMerge, onClose, onDismiss, onKill, onSwitchAgent]
  );

  const now = useNow();
  const state = agentState(agent, now);

  const isRunning = agent.status === 'running';
  const isLive = isAgentLive(agent, now);

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
        aria-labelledby="agent-terminal-modal-title"
        className="flex flex-col w-[95vw] h-[90vh] rounded-xl border border-white/10 bg-[#050510] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 glass flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br ${isRunning ? 'from-primary/20 to-transparent' : 'from-white/5 to-transparent'}`}
            >
              <AuricIcon name="terminal" className="text-lg text-foreground" />
              {isRunning && (
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 translate-x-1/3 translate-y-1/3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="agent-terminal-modal-title" className="text-sm font-bold text-foreground">
                  {agent.name}
                </h2>
                <ComboProgressBadge agentId={agent.id} />
                <span
                  className={`text-[9px] font-black uppercase tracking-widest ${isRunning ? 'text-primary' : 'text-foreground-muted'}`}
                >
                  {AGENT_STATE_LABEL[state]}
                </span>
                {isLive && (
                  <span className="animate-pulse rounded-full bg-primary/20 px-1.5 py-0.5 text-[7px] font-black text-primary border border-primary/30 uppercase tracking-tighter">
                    Live
                  </span>
                )}
              </div>
              {agent.currentTask && (
                <p className="text-[10px] text-foreground-muted max-w-xl truncate">
                  {agent.currentTask}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-foreground-muted opacity-40">
              {agent.id}
            </span>
            <button
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="rounded-lg p-2 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
            >
              <AuricIcon name="close" className="text-lg" />
            </button>
          </div>
        </div>

        {errorDigest && (
          <div
            data-testid="terminal-error-digest"
            className="flex flex-shrink-0 items-center gap-2 border-b border-red-400/20 bg-red-500/5 px-5 py-2"
          >
            <AuricIcon name="error" aria-hidden="true" className="text-sm text-red-400" />
            <span className="truncate font-mono text-[11px] text-red-300">{errorDigest}</span>
          </div>
        )}

        {/* Agent tabs — fast switching between active agents with state preview,
            grouped per project so a fleet spanning repositories reads as one. */}
        {agents && agents.length > 0 && (
          <div
            role="tablist"
            aria-label="Active agents"
            className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-black/40 overflow-x-auto no-scrollbar flex-shrink-0"
          >
            {tabGroups.map((group, groupIndex) => (
              <div
                key={group.repoPath ?? UNGROUPED_REPO_KEY}
                data-testid={`agent-tab-group-${group.repoPath ?? UNGROUPED_REPO_KEY}`}
                style={{
                  flexGrow: group.agents.length,
                  flexShrink: 0,
                  flexBasis: 0,
                  minWidth: showTabGroupLabels
                    ? `calc(${group.agents.length} * 10rem + 8rem)`
                    : `calc(${group.agents.length} * 10rem)`,
                }}
                className={`flex items-center gap-1 overflow-hidden ${
                  groupIndex > 0 ? 'ml-1 border-l border-white/10 pl-2' : ''
                }`}
              >
                {showTabGroupLabels && (
                  <span
                    title={group.repoPath ?? undefined}
                    className="mr-0.5 max-w-[120px] flex-shrink-0 truncate text-[8px] font-black uppercase tracking-widest text-foreground-muted/70"
                  >
                    {group.label}
                  </span>
                )}
                {group.agents.map((a) => {
                  const isActive = a.id === agent.id;
                  const canEnd = isFinishedAgent(a) ? !!onDismiss : !!onKill;
                  return (
                    <AgentTab
                      key={a.id}
                      agent={a}
                      isActive={isActive}
                      now={now}
                      onSelect={() => {
                        if (!isActive) onSwitchAgent?.(a);
                      }}
                      onEnd={canEnd ? () => void closeTab(a) : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* xterm.js Terminal */}
        <div className="flex-1 min-h-0 p-2">
          <AgentXterm agentId={agent.id} onSelectionSpawn={onSelectionSpawn} />
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

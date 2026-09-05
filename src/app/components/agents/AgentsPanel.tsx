'use client';

import type React from 'react';
import type { AgentInfo, InterruptedAgent } from '@/lib/tauri/agents';
import { groupAgentsByRepo, UNGROUPED_REPO_KEY } from '@/lib/store/agentSlice';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import { useState } from 'react';
import { useNow } from '@/lib/hooks/useNow';
import { splitFleet } from '@/lib/agents/fleet';
import {
  countNeedingAttention,
  needsAttention,
  sortByUrgency,
  withReviewFlags,
} from '@/lib/agents/attention';
import { AGENT_COLORS, type AgentColor } from '@/lib/agents/colors';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import { AgentCard } from './AgentCard';
import { CompactAgentRow } from './CompactAgentRow';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { AgentsPanelHeader } from './panel/AgentsPanelHeader';
import { InterruptedAgentsSection } from './panel/InterruptedAgentsSection';
import { FinishedAgentsSection } from './panel/FinishedAgentsSection';

export { AgentsPanelHeader } from './panel/AgentsPanelHeader';
export { InterruptedAgentsSection } from './panel/InterruptedAgentsSection';
export { FinishedAgentsSection } from './panel/FinishedAgentsSection';

export interface AgentsPanelProps {
  agents: AgentInfo[];
  /** Agents from a previous app run, restorable via Resume (restart persistence). */
  interruptedAgents?: InterruptedAgent[];
  onSpawn: () => void;
  onKill: (id: string) => void;
  onKillRepo?: (repoPath: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onImageDrop?: (agentId: string, imageData: string) => void;
  onCollapse?: () => void;
  /** Opens the full-area Agent Console — the fleet-wide view across projects. */
  onOpenConsole?: () => void;
  onResumeInterrupted?: (agentId: string) => void;
  onDiscardInterrupted?: (agentId: string) => void;
  /** Agents folded down to a one-line row — still running, just out of the way. */
  minimizedAgentIds?: string[];
  onToggleMinimize?: (agentId: string, minimized: boolean) => void;
  onRename?: (agentId: string, name: string) => void;
  /** Clear a stopped agent out of the list once its output has been read. */
  onDismissFinished?: (agentId: string) => void;
  /** Repo groups folded shut, by repo path (or 'Unknown'). */
  collapsedRepos?: string[];
  onToggleRepoCollapsed?: (repoPath: string) => void;
  /** Marker colours by agent id, for grouping and flagging agents. */
  agentColors?: Record<string, AgentColor>;
  onSetColor?: (agentId: string, color: AgentColor | null) => void;
  /** Stopped agents whose outcome has been opened — the rest show unseen. */
  reviewedAgentIds?: string[];
  /** Relaunch a failed agent with its original config. */
  onRetryFailed?: (agentId: string) => void;
}

export function AgentsPanel({
  agents,
  interruptedAgents = [],
  onSpawn,
  onKill,
  onKillRepo,
  onSelectAgent,
  onImageDrop,
  onCollapse,
  onOpenConsole,
  onResumeInterrupted,
  onDiscardInterrupted,
  minimizedAgentIds = [],
  onToggleMinimize,
  onRename,
  onDismissFinished,
  collapsedRepos = [],
  onToggleRepoCollapsed,
  agentColors = {},
  onSetColor,
  reviewedAgentIds = [],
  onRetryFailed,
}: AgentsPanelProps): React.JSX.Element {
  const [colorMenu, setColorMenu] = useState<{ x: number; y: number; agentId: string } | null>(
    null
  );

  const openColorMenu = (e: React.MouseEvent, agentId: string) => {
    if (!onSetColor) return;
    e.preventDefault();
    e.stopPropagation();
    setColorMenu({ x: e.clientX, y: e.clientY, agentId });
  };

  const colorMenuOptions = (agentId: string): ContextMenuOption[] => [
    { type: 'header', label: 'Colour' },
    ...AGENT_COLORS.map((option) => ({
      label: option.label,
      icon: 'circle',
      iconColor: option.hex,
      action: () => onSetColor?.(agentId, option.key),
    })),
    ...(agentColors[agentId]
      ? [
          { type: 'separator' as const },
          {
            label: 'Remove colour',
            icon: 'format_color_reset',
            action: () => onSetColor?.(agentId, null),
          },
        ]
      : []),
  ];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string' && onImageDrop) {
          onImageDrop(agentId, reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const { active, finished, parked } = splitFleet(agents, minimizedAgentIds);
  const grouped = groupAgentsByRepo(active);
  const repoKeys = Object.keys(grouped);
  const runningCount = agents.filter((a) => a.status === 'running').length;

  const now = useNow();
  const flagged = withReviewFlags(agents, reviewedAgentIds);
  const attentionCount = countNeedingAttention(flagged, now);
  const attentionAgents = sortByUrgency(flagged, now);
  const reviewList = finished.filter(
    (a) => a.status !== 'error' || reviewedAgentIds.includes(a.id)
  );
  const parkableAgents = onToggleMinimize
    ? active.filter((a) => a.status === 'running' && !needsAttention(a, now))
    : [];

  const { confirm, confirmDialog } = useConfirm();
  const offerMerge = useWorktreeMergeOffer(confirm);

  const confirmKill = async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent?.status === 'running') {
      const go = await confirm({
        title: 'Stop this agent?',
        message: `Stop ${agent.name}? Its work in progress is lost.`,
        confirmLabel: 'Stop',
      });
      if (!go) return;
    }
    await Promise.resolve(onKill(agentId));
    await offerMerge(agent);
  };

  const dismissFinished = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    onDismissFinished?.(agentId);
    void offerMerge(agent);
  };

  const confirmKillRepo = async (repoPath: string) => {
    const running = agents.filter(
      (a) => (a.repoPath ?? UNGROUPED_REPO_KEY) === repoPath && a.status === 'running'
    ).length;
    const repoName =
      repoPath === UNGROUPED_REPO_KEY ? 'this group' : (repoPath.split('/').pop() ?? repoPath);
    const what = running === 1 ? '1 running agent' : `${running} running agents`;
    if (running > 0) {
      const go = await confirm({
        title: 'Stop all agents?',
        message: `Stop ${what} in ${repoName}? Their work in progress is lost.`,
        confirmLabel: 'Stop all',
      });
      if (!go) return;
    }
    onKillRepo?.(repoPath);
  };

  return (
    <div data-testid="agents-panel" className="flex flex-col h-full bg-panel-bg">
      <AgentsPanelHeader
        runningCount={runningCount}
        attentionCount={attentionCount}
        parkableCount={parkableAgents.length}
        onParkAllWorking={
          onToggleMinimize
            ? () => parkableAgents.forEach((a) => onToggleMinimize?.(a.id, true))
            : undefined
        }
        onOpenConsole={onOpenConsole}
        onCollapse={onCollapse}
      />

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {attentionAgents.length > 0 && (
          <div data-testid="attention-agents" className="flex flex-col gap-0.5">
            <span className="px-1.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
              Needs attention · {attentionAgents.length}
            </span>
            {attentionAgents.map((agent) => (
              <CompactAgentRow
                key={agent.id}
                agent={agent}
                activateLabel="Check on"
                onActivate={(id) => onSelectAgent?.(id)}
                dismissLabel={agent.status === 'error' ? 'Dismiss' : 'Terminate'}
                dismissIcon={agent.status === 'error' ? 'close' : 'power_settings_new'}
                onDismiss={
                  agent.status === 'error'
                    ? (id) => dismissFinished(id)
                    : (id) => void confirmKill(id)
                }
                color={agentColors[agent.id]}
                onContextMenu={onSetColor && openColorMenu}
                onRetry={onRetryFailed}
              />
            ))}
          </div>
        )}

        <InterruptedAgentsSection
          interruptedAgents={interruptedAgents}
          onResumeInterrupted={onResumeInterrupted}
          onDiscardInterrupted={onDiscardInterrupted}
        />

        {agents.length === 0 ? (
          <p className="text-xs text-foreground-muted text-center py-4">No agents running</p>
        ) : (
          repoKeys.map((repoPath) => {
            const repoName = repoPath === 'Unknown' ? 'Unknown' : repoPath.split('/').pop();
            const isCollapsed = collapsedRepos.includes(repoPath);
            const groupAgents = grouped[repoPath];

            return (
              <div key={repoPath} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  {onToggleRepoCollapsed ? (
                    <button
                      type="button"
                      onClick={() => onToggleRepoCollapsed(repoPath)}
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${repoName}`}
                      className="group/repo -ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
                    >
                      <AuricIcon
                        name="expand_more"
                        aria-hidden="true"
                        className={`text-sm transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      />
                      {repoName}
                      {isCollapsed && (
                        <span className="ml-0.5 rounded-full bg-white/5 px-1.5 text-[10px] tabular-nums">
                          {groupAgents.length}
                        </span>
                      )}
                      {isCollapsed && groupAgents.some((a) => needsAttention(a, now)) && (
                        <span
                          data-testid="repo-attention-dot"
                          role="img"
                          aria-label="Agent needs attention"
                          className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                        />
                      )}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-foreground-muted">{repoName}</span>
                  )}
                  {onKillRepo && (
                    <button
                      type="button"
                      onClick={() => void confirmKillRepo(repoPath)}
                      aria-label={`Stop all agents in ${repoName}`}
                      className="min-h-6 rounded px-1.5 py-0.5 text-[10px] text-foreground-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400/60"
                    >
                      Stop all
                    </button>
                  )}
                </div>
                {!isCollapsed &&
                  groupAgents.map((agent) => (
                    <div
                      key={agent.id}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, agent.id)}
                      className="min-w-0"
                    >
                      <AgentCard
                        agent={agent}
                        onKill={(id) => void confirmKill(id)}
                        onSelect={onSelectAgent}
                        onMinimize={onToggleMinimize && ((id) => onToggleMinimize(id, true))}
                        onRename={onRename}
                        color={agentColors[agent.id]}
                        onContextMenu={onSetColor && openColorMenu}
                      />
                    </div>
                  ))}
              </div>
            );
          })
        )}

        {parked.length > 0 && (
          <div data-testid="parked-agents" className="mt-1 flex flex-col gap-0.5">
            <span className="px-1.5 text-[10px] font-black uppercase tracking-widest text-foreground-muted/60">
              Set aside · {parked.length}
            </span>
            {parked.map((agent) => (
              <CompactAgentRow
                key={agent.id}
                agent={agent}
                activateLabel="Restore"
                onActivate={(id) => onToggleMinimize?.(id, false)}
                dismissLabel="Terminate"
                dismissIcon="power_settings_new"
                onDismiss={(id) => void confirmKill(id)}
                color={agentColors[agent.id]}
                onContextMenu={onSetColor && openColorMenu}
              />
            ))}
          </div>
        )}

        <FinishedAgentsSection
          reviewList={reviewList}
          reviewedAgentIds={reviewedAgentIds}
          agentColors={agentColors}
          onSelectAgent={onSelectAgent}
          onDismissFinished={dismissFinished}
          onSetColor={onSetColor}
          openColorMenu={openColorMenu}
          onRetryFailed={onRetryFailed}
        />
      </div>

      <div className="p-2 border-t border-border-dark">
        <button
          type="button"
          onClick={onSpawn}
          className="w-full text-xs py-1.5 rounded bg-primary text-white hover:brightness-110 transition-[filter]"
        >
          Start agent
        </button>
      </div>

      {colorMenu && (
        <ContextMenu
          x={colorMenu.x}
          y={colorMenu.y}
          options={colorMenuOptions(colorMenu.agentId)}
          onClose={() => setColorMenu(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

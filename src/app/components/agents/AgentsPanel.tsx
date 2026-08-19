'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { groupAgentsByRepo, UNGROUPED_REPO_KEY } from '@/lib/store/agentSlice';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import type { InterruptedAgent } from '@/lib/tauri/agents';
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

  /**
   * Right-click marks an agent. Colours are a grouping tool the user invents
   * meanings for, so the menu offers the palette and nothing else — and
   * "Remove" only appears when there is a marker to remove.
   */
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

  // Cards are for work in progress. Agents that have stopped and agents you
  // set aside are worth one line each — the running count below still speaks
  // for the whole fleet, however each of them happens to be drawn.
  const { active, finished, parked } = splitFleet(agents, minimizedAgentIds);

  const grouped = groupAgentsByRepo(active);
  const repoKeys = Object.keys(grouped);
  const runningCount = agents.filter((a) => a.status === 'running').length;
  // Counted over the whole fleet — parked agents and folded groups included.
  // The badge is the one number that decides whether you need to look at all,
  // so nothing the view hides may be missing from it.
  const now = useNow();
  // Review-aware: a failure whose logs were opened is acknowledged and stops
  // claiming attention — an alarm that cannot be quitted gets ignored.
  const flagged = withReviewFlags(agents, reviewedAgentIds);
  const attentionCount = countNeedingAttention(flagged, now);
  // The one place to check when the badge says something needs you, most
  // urgent first — the triage list must be trustable by position. Parked
  // agents included: parking is a view state, their claim on the user is not
  // parked with it. Cards stay put in their repo groups — this section
  // points, it does not move things under the cursor.
  const attentionAgents = sortByUrgency(flagged, now);
  // An unreviewed failure lives in the attention section only; rendering it
  // again under Done would be the same alarm twice, with disagreeing state.
  // Once reviewed it migrates down here, dot-free.
  const reviewList = finished.filter(
    (a) => a.status !== 'error' || reviewedAgentIds.includes(a.id)
  );
  // Healthy working agents still drawn as cards — the candidates for a
  // one-move park that leaves only what needs a human on screen.
  const parkableAgents = onToggleMinimize
    ? active.filter((a) => a.status === 'running' && !needsAttention(a, now))
    : [];

  // Asked in-app and awaited. The browser's confirm() keeps running the script
  // inside the Tauri webview, which let a kill happen before the user answered.
  const { confirm, confirmDialog } = useConfirm();
  const offerMerge = useWorktreeMergeOffer(confirm);

  /**
   * The terminate control sits a few pixels from the terminal toggle and only
   * appears on hover, so a mis-click is easy and costs everything the agent
   * has done so far. An agent that has already stopped has nothing left to
   * lose, so asking there would be friction for its own sake.
   */
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

  /**
   * Killing a repo's agents throws away however much work they had done, and
   * the button sits one row above the cards. Name the cost before doing it.
   */
  const confirmKillRepo = async (repoPath: string) => {
    // Counted over every agent in the repo, parked ones included — Kill All
    // stops those too, so hiding them from the count would understate the loss.
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
      {/* The screen-reader version of the amber badge: visual pings are
          exactly what a non-sighted user cannot poll. Polite, and silent
          while there is nothing to say. */}
      <div role="status" aria-live="polite" className="sr-only">
        {attentionCount > 0 &&
          `${attentionCount} agent${attentionCount === 1 ? '' : 's'} need${
            attentionCount === 1 ? 's' : ''
          } attention`}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1 px-3 py-2 border-b border-border-dark">
        <h2 className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold tracking-wider text-foreground-muted">
          {/* Not "active agents": the panel also holds the ones you parked and
              the ones that have stopped. The count is what says how much is
              actually happening. */}
          AGENTS
          {runningCount > 0 && (
            <span
              data-testid="agents-running-count"
              className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary-light tabular-nums"
            >
              {runningCount} running
            </span>
          )}
          {/* Only rendered while something actually needs a human — its
              absence is the "all fine" signal, and a standing zero would be
              one more thing to read on every glance. */}
          {attentionCount > 0 && (
            <span
              data-testid="agents-attention-count"
              className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-400 tabular-nums"
            >
              {attentionCount} {attentionCount === 1 ? 'needs' : 'need'} attention
            </span>
          )}
          {runningCount > 0 && attentionCount === 0 && (
            <span
              data-testid="agents-all-quiet"
              className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-400/70"
            >
              <AuricIcon name="check" aria-hidden="true" className="text-[12px]" />
              all quiet
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          {parkableAgents.length > 1 && (
            <button
              type="button"
              onClick={() => parkableAgents.forEach((a) => onToggleMinimize?.(a.id, true))}
              title="Set aside working (still running)"
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              Set aside {parkableAgents.length}
            </button>
          )}
          {onOpenConsole && (
            <button
              type="button"
              data-testid="agents-open-console"
              onClick={onOpenConsole}
              aria-label="Open Agent Console"
              title="Open Agent Console"
              className="group flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <AuricIcon name="dashboard" aria-hidden="true" className="text-base" />
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Hide agents panel"
              className="group flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <AuricIcon name="right_panel_close" aria-hidden="true" className="text-base" />
            </button>
          )}
        </div>
      </div>

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
        {interruptedAgents.length > 0 && (
          <div data-testid="interrupted-agents" className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
              INTERRUPTED
            </span>
            {interruptedAgents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">
                    {agent.name}
                  </span>
                  <span className="font-mono text-[9px] text-foreground-muted opacity-50 flex-shrink-0">
                    {agent.id}
                  </span>
                </div>
                <p className="text-[10px] text-foreground-muted line-clamp-2">{agent.task}</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => onResumeInterrupted?.(agent.id)}
                    className="flex-1 text-[10px] font-bold py-1 rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscardInterrupted?.(agent.id)}
                    className="flex-1 text-[10px] font-bold py-1 rounded bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
                  {/* Working across several repos means several stacks of
                      cards; folding the ones you are not watching is the
                      difference between scanning and scrolling. */}
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
                      {/* Folding hides cards, never facts: a hidden agent's
                          claim on the user stays visible on the fold. */}
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

        {/* Stopped agents are kept for review, but a finished agent has no
            claim on a full card — it is a list you scan, not one you watch. */}
        {reviewList.length > 0 && (
          <div data-testid="finished-agents" className="mt-1 flex flex-col gap-0.5">
            <div className="flex items-center justify-between px-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-foreground-muted/60">
                Done · {reviewList.length}
              </span>
              {onDismissFinished && reviewList.length > 1 && (
                <button
                  type="button"
                  // A failure nobody looked at survives the sweep: bulk-clear
                  // must not be the panel deciding an error did not matter.
                  // (Unreviewed failures are not even in this list — they
                  // still sit in the attention section above.)
                  onClick={() =>
                    reviewList
                      .filter((a) => a.status !== 'error' || reviewedAgentIds.includes(a.id))
                      .forEach((a) => onDismissFinished(a.id))
                  }
                  title="Clear done (keep unreviewed fails)"
                  className="rounded px-1 text-[10px] text-foreground-muted/60 transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            {reviewList.map((agent) => (
              <CompactAgentRow
                key={agent.id}
                agent={agent}
                activateLabel="Open logs of"
                onActivate={(id) => onSelectAgent?.(id)}
                dismissLabel="Dismiss"
                dismissIcon="close"
                onDismiss={(id) => dismissFinished(id)}
                color={agentColors[agent.id]}
                onContextMenu={onSetColor && openColorMenu}
                unseen={!reviewedAgentIds.includes(agent.id)}
                onRetry={onRetryFailed}
              />
            ))}
          </div>
        )}
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

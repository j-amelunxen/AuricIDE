'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { groupAgentsByRepo } from '@/lib/store/agentSlice';
import type { InterruptedAgent } from '@/lib/tauri/agents';
import { useState } from 'react';
import { splitFleet } from '@/lib/agents/fleet';
import { AGENT_COLORS, type AgentColor } from '@/lib/agents/colors';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import { AgentCard } from './AgentCard';
import { CompactAgentRow } from './CompactAgentRow';

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

  /**
   * The terminate control sits a few pixels from the terminal toggle and only
   * appears on hover, so a mis-click is easy and costs everything the agent
   * has done so far. An agent that has already stopped has nothing left to
   * lose, so asking there would be friction for its own sake.
   */
  const confirmKill = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (
      agent?.status === 'running' &&
      !confirm(`Stop ${agent.name}? Its work in progress is lost.`)
    ) {
      return;
    }
    onKill(agentId);
  };

  /**
   * Killing a repo's agents throws away however much work they had done, and
   * the button sits one row above the cards. Name the cost before doing it.
   */
  const confirmKillRepo = (repoPath: string) => {
    // Counted over every agent in the repo, parked ones included — Kill All
    // stops those too, so hiding them from the count would understate the loss.
    const running = agents.filter(
      (a) => (a.repoPath ?? 'Unknown') === repoPath && a.status === 'running'
    ).length;
    const repoName =
      repoPath === 'Unknown' ? 'this group' : (repoPath.split('/').pop() ?? repoPath);
    const what = running === 1 ? '1 running agent' : `${running} running agents`;
    if (running > 0 && !confirm(`Stop ${what} in ${repoName}? Their work in progress is lost.`)) {
      return;
    }
    onKillRepo?.(repoPath);
  };

  return (
    <div data-testid="agents-panel" className="flex flex-col h-full bg-panel-bg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-dark">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-foreground-muted">
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
        </h2>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide agents panel"
            className="group flex h-5 w-5 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">
              right_panel_close
            </span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
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
                      <span
                        aria-hidden="true"
                        className={`material-symbols-outlined text-sm transition-transform ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                      >
                        expand_more
                      </span>
                      {repoName}
                      {isCollapsed && (
                        <span className="ml-0.5 rounded-full bg-white/5 px-1.5 text-[10px] tabular-nums">
                          {groupAgents.length}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-foreground-muted">{repoName}</span>
                  )}
                  {onKillRepo && (
                    <button
                      type="button"
                      onClick={() => confirmKillRepo(repoPath)}
                      className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
                    >
                      Kill All
                    </button>
                  )}
                </div>
                {!isCollapsed &&
                  groupAgents.map((agent) => (
                    <div
                      key={agent.id}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, agent.id)}
                      className="rounded transition hover:ring-2 hover:ring-primary/50"
                    >
                      <AgentCard
                        agent={agent}
                        onKill={confirmKill}
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
              Parked · {parked.length}
            </span>
            {parked.map((agent) => (
              <CompactAgentRow
                key={agent.id}
                agent={agent}
                activateLabel="Restore"
                onActivate={(id) => onToggleMinimize?.(id, false)}
                dismissLabel="Terminate"
                dismissIcon="power_settings_new"
                onDismiss={confirmKill}
                color={agentColors[agent.id]}
                onContextMenu={onSetColor && openColorMenu}
              />
            ))}
          </div>
        )}

        {/* Stopped agents are kept for review, but a finished agent has no
            claim on a full card — it is a list you scan, not one you watch. */}
        {finished.length > 0 && (
          <div data-testid="finished-agents" className="mt-1 flex flex-col gap-0.5">
            <div className="flex items-center justify-between px-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-foreground-muted/60">
                Done · {finished.length}
              </span>
              {onDismissFinished && finished.length > 1 && (
                <button
                  type="button"
                  onClick={() => finished.forEach((a) => onDismissFinished(a.id))}
                  className="rounded px-1 text-[10px] text-foreground-muted/60 transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            {finished.map((agent) => (
              <CompactAgentRow
                key={agent.id}
                agent={agent}
                activateLabel="Open logs of"
                onActivate={(id) => onSelectAgent?.(id)}
                dismissLabel="Dismiss"
                dismissIcon="close"
                onDismiss={(id) => onDismissFinished?.(id)}
                color={agentColors[agent.id]}
                onContextMenu={onSetColor && openColorMenu}
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
          New Agent…
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
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import type { HeartbeatBucket } from '@/lib/agents/events/heartbeat';
import { heartbeatSeries } from '@/lib/agents/events/heartbeat';
import { consoleAgentState, CONSOLE_STATE_RANK } from '@/lib/agents/consoleState';
import type { AgentColor } from '@/lib/agents/colors';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useSpawnLauncher } from '@/lib/quickAccess/useSpawnLauncher';
import {
  quickAccessSkills,
  quickAccessCombos,
  type QuickAccessSkill,
  type QuickAccessCombo,
} from '@/lib/store/starredProjectsSlice';
import { comboMenuLabel } from '@/lib/quickAccess/combo';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { ConsoleAgentCard } from './ConsoleAgentCard';

function repoName(repoPath: string): string {
  return repoPath.split('/').pop() || repoPath;
}

export interface ProjectSectionProps {
  repoPath: string;
  agents: AgentInfo[];
  agentEvents: Record<string, AgentEvent[]>;
  agentHeartbeat: Record<string, HeartbeatBucket[]>;
  /**
   * The fleet's tallest minute — the shared vertical scale every card's chart
   * is drawn against. Computed once by the console, not per section, because
   * comparing two agents is the whole reason the chart exists.
   */
  heartbeatScaleMax: number;
  reviewedAgentIds: string[];
  agentColors?: Record<string, AgentColor>;
  onFocus?: (agentId: string) => void;
  onOpenTerminal: (agentId: string) => void;
  onStop: (agentId: string) => void;
  onRetry: (agentId: string) => void;
  onMarkReviewed: (agentId: string) => void;
  onDismiss: (agentId: string) => void;
  onStopAll: (repoPath: string) => void;
  onOpenProject?: (repoPath: string) => void;
}

/**
 * One project's terrain in the Agent Console: its running/finished agents as
 * cards, sorted so whichever needs a human sits first. Owns its own spawn and
 * combo launching — the same one path (`openSkillSpawnDialog`) Quick Access
 * uses — so starting work from here behaves identically to starting it from
 * the cockpit.
 */
export function ProjectSection({
  repoPath,
  agents,
  agentEvents,
  agentHeartbeat,
  heartbeatScaleMax,
  reviewedAgentIds,
  agentColors = {},
  onFocus,
  onOpenTerminal,
  onStop,
  onRetry,
  onMarkReviewed,
  onDismiss,
  onStopAll,
  onOpenProject,
}: ProjectSectionProps) {
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const starredProjects = useStore((s) => s.starredProjects);
  const startSkillCombo = useStore((s) => s.startSkillCombo);
  const launchSpawnDialog = useSpawnLauncher();

  const project = starredProjects.find((p) => p.path === repoPath);
  const skills = project ? quickAccessSkills(project) : [];
  const combos = project ? quickAccessCombos(project) : [];

  const spawn = (skill?: QuickAccessSkill) => launchSpawnDialog(repoPath, skill);

  const launchCombo = (combo: QuickAccessCombo) => void startSkillCombo(repoPath, combo);

  const withReview = agents.map((agent) => ({
    agent,
    reviewed: reviewedAgentIds.includes(agent.id),
    state: consoleAgentState(agent, reviewedAgentIds.includes(agent.id), now),
  }));
  const sorted = [...withReview].sort(
    (a, b) => CONSOLE_STATE_RANK[a.state] - CONSOLE_STATE_RANK[b.state]
  );

  const running = withReview.filter((x) => x.state !== 'done' && x.state !== 'error').length;
  const doneUnreviewed = agents.filter(
    (a) => a.status === 'idle' && !reviewedAgentIds.includes(a.id)
  ).length;
  const needsAttention = withReview.some(
    (x) => x.state === 'yours' || x.state === 'stalled' || (x.state === 'error' && !x.reviewed)
  );

  const runningAgentIds = agents.filter((a) => a.status === 'running').map((a) => a.id);

  const confirmStopAll = async () => {
    if (runningAgentIds.length > 0) {
      const what =
        runningAgentIds.length === 1
          ? '1 running agent'
          : `${runningAgentIds.length} running agents`;
      const go = await confirm({
        title: 'Stop all agents?',
        message: `Stop ${what} in ${repoName(repoPath)}? Their work in progress is lost.`,
        confirmLabel: 'Stop all',
      });
      if (!go) return;
    }
    onStopAll(repoPath);
  };

  const menuOptions: ContextMenuOption[] = [
    ...(combos.length > 0
      ? ([
          { type: 'header', label: 'Combos' },
          ...combos.map((combo) => ({
            label: comboMenuLabel(combo),
            icon: 'account_tree',
            action: () => launchCombo(combo),
          })),
          { type: 'separator' },
        ] as ContextMenuOption[])
      : []),
    ...(skills.length > 0
      ? ([
          { type: 'header', label: 'Skills' },
          ...skills.map((skill) => ({
            label: skill.label,
            icon: 'auto_awesome',
            action: () => spawn(skill),
          })),
          { type: 'separator' },
        ] as ContextMenuOption[])
      : []),
    { label: 'Start agent', icon: 'bolt', action: () => spawn() },
    ...(onOpenProject
      ? [{ label: 'Open project', icon: 'folder_open', action: () => onOpenProject(repoPath) }]
      : []),
  ];

  return (
    <div
      data-testid={`project-section-${repoPath}`}
      data-needs-attention={needsAttention ? 'true' : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      // The same menu from the keyboard. Both keys are the platform
      // conventions for "open the context menu here"; anchoring it to the
      // section's own box means it appears where the eye already is rather
      // than at a stale pointer position.
      onKeyDown={(e) => {
        if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        setMenu({ x: box.left + 16, y: box.top + 16 });
      }}
      className={`group rounded-2xl border bg-panel-bg/60 p-3 transition-colors ${
        needsAttention
          ? 'border-amber-500/45 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <ProjectTileFace path={repoPath} icon={project?.icon} className="h-6 w-6 text-[10px]" />
        <span className="text-[13px] font-semibold text-foreground">{repoName(repoPath)}</span>
        <span className="whitespace-nowrap font-mono text-[11px] text-foreground-muted">
          {agents.length === 0
            ? 'idle'
            : `${running} running${doneUnreviewed > 0 ? ` · ${doneUnreviewed} done, unreviewed` : ''}`}
        </span>
        <span
          data-testid="project-section-actions"
          // Hover-revealed, but focus has to reveal them too — otherwise Tab
          // lands on a button nobody can see.
          className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <button
            type="button"
            onClick={() => spawn()}
            className="rounded px-1.5 py-0.5 text-[10px] text-foreground-muted hover:bg-white/5 hover:text-foreground"
          >
            Spawn agent
          </button>
          {agents.length > 0 && (
            <button
              type="button"
              onClick={() => void confirmStopAll()}
              className="rounded px-1.5 py-0.5 text-[10px] text-foreground-muted hover:bg-red-500/10 hover:text-red-400"
            >
              Stop all
            </button>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {sorted.map(({ agent, reviewed }) => (
          <ConsoleAgentCard
            key={agent.id}
            agent={agent}
            events={agentEvents[agent.id] ?? []}
            heartbeat={heartbeatSeries(agentHeartbeat[agent.id] ?? [], now)}
            heartbeatScaleMax={heartbeatScaleMax}
            reviewed={reviewed}
            color={agentColors[agent.id]}
            onFocus={onFocus}
            onOpenTerminal={onOpenTerminal}
            onStop={onStop}
            onRetry={onRetry}
            onMarkReviewed={onMarkReviewed}
            onDismiss={onDismiss}
          />
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} options={menuOptions} onClose={() => setMenu(null)} />
      )}
      {confirmDialog}
    </div>
  );
}

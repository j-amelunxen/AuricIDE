'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { groupAgentsByRepo } from '@/lib/store/agentSlice';
import { consoleAgentState } from '@/lib/agents/consoleState';
import { consoleSummaryLine, consoleAttentionBadge } from '@/lib/agents/consoleSummary';
import { countNeedingAttention, withReviewFlags } from '@/lib/agents/attention';
import { useNow } from '@/lib/hooks/useNow';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { CliQuotaChip } from '@/app/components/usage/CliQuotaChip';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectSection, type ProjectSectionProps } from './ProjectSection';
import { ActivityFeed } from './ActivityFeed';
import { FocusView } from './FocusView';

const LEGEND: { color: string; label: string }[] = [
  { color: 'bg-amber-400', label: 'Waiting on you' },
  { color: 'bg-emerald-400', label: 'Running' },
  { color: 'bg-primary', label: 'Done, unreviewed' },
  { color: 'bg-red-400', label: 'Failed' },
];

export interface AgentConsoleProps {
  /**
   * Opens this agent's full terminal. `AgentTerminalModal` shares this
   * component's `z-[var(--z-tool)]` layer, so it only paints above the
   * console because `IDEOverlays` mounts `<AgentConsole/>` first — moving
   * that mount order would silently put the console back on top.
   */
  onOpenTerminal: (agentId: string) => void;
}

/**
 * The full-area overlay for orchestrating a fleet: every agent grouped by
 * project, sorted so whichever project needs a human sits first, with a
 * merged live activity feed pinned at the bottom. Returns null when closed —
 * the same null-guard pattern as `BlueprintsGallery`.
 */
export function AgentConsole({ onOpenTerminal }: AgentConsoleProps) {
  const agentConsoleOpen = useStore((s) => s.agentConsoleOpen);
  if (!agentConsoleOpen) return null;
  return <AgentConsoleContent onOpenTerminal={onOpenTerminal} />;
}

function AgentConsoleContent({ onOpenTerminal }: AgentConsoleProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const now = useNow();
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);

  const closeAgentConsole = useStore((s) => s.closeAgentConsole);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);
  const agents = useStore((s) => s.agents);
  const agentEvents = useStore((s) => s.agentEvents);
  const agentHeartbeat = useStore((s) => s.agentHeartbeat);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);
  const agentColors = useStore((s) => s.agentColors);
  const starredProjects = useStore((s) => s.starredProjects);
  const killRunningAgent = useStore((s) => s.killRunningAgent);
  const killAgentsForRepoPath = useStore((s) => s.killAgentsForRepoPath);
  const dismissFinishedAgent = useStore((s) => s.dismissFinishedAgent);
  const retryFailedAgent = useStore((s) => s.retryFailedAgent);
  const markAgentReviewed = useStore((s) => s.markAgentReviewed);

  // While focused, Esc steps back to the grid — it only falls through to
  // closing the whole console once nothing is focused.
  useOverlayLayer({
    id: 'agent-console',
    kind: 'tool',
    active: true,
    onEscape: focusedAgentId ? () => setFocusedAgentId(null) : closeAgentConsole,
  });

  const focusedAgent = focusedAgentId
    ? agents.find((agent) => agent.id === focusedAgentId)
    : undefined;

  const grouped = useMemo(() => groupAgentsByRepo(agents), [agents]);
  const activeRepoPaths = Object.keys(grouped);

  const needsAttention = (repoPath: string) =>
    grouped[repoPath].some((agent) => {
      const reviewed = reviewedAgentIds.includes(agent.id);
      const state = consoleAgentState(agent, reviewed, now);
      return state === 'yours' || state === 'stalled' || (state === 'error' && !reviewed);
    });

  const sortedActive = [...activeRepoPaths].sort(
    (a, b) => Number(needsAttention(b)) - Number(needsAttention(a))
  );
  const idleProjects = starredProjects.filter((p) => !grouped[p.path]);

  // By process status, not the 'working' console bucket — an agent waiting
  // on a permission prompt or gone quiet is still a running process, and
  // this count has to agree with every section's own "N running", which
  // counts the same way.
  const running = agents.filter((agent) => agent.status === 'running').length;
  const needing = countNeedingAttention(withReviewFlags(agents, reviewedAgentIds), now);
  const doneUnreviewed = agents.filter(
    (agent) => agent.status === 'idle' && !reviewedAgentIds.includes(agent.id)
  ).length;

  // Every ProjectSection — active or idle — is wired to the same store
  // actions; only `repoPath` and `agents` vary between the two grids below.
  const sectionProps: Omit<ProjectSectionProps, 'repoPath' | 'agents'> = {
    agentEvents,
    agentHeartbeat,
    reviewedAgentIds,
    agentColors,
    onFocus: setFocusedAgentId,
    onOpenTerminal,
    onStop: (id) => void killRunningAgent(id),
    onRetry: (id) => void retryFailedAgent(id),
    onMarkReviewed: markAgentReviewed,
    onDismiss: dismissFinishedAgent,
    onStopAll: (repoPath) => void killAgentsForRepoPath(repoPath),
  };

  return (
    <div className="fixed inset-0 z-[var(--z-tool)] flex flex-col bg-[#050508]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-console-title"
        className="flex h-full min-h-0 flex-col"
      >
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
          <h1 id="agent-console-title" className="text-xs font-bold tracking-wide text-foreground">
            Agent Console
          </h1>
          <span data-testid="agent-console-summary" className="text-[11px] text-foreground-muted">
            {consoleSummaryLine({
              running,
              projects: activeRepoPaths.length,
              needing,
              doneUnreviewed,
            })}
          </span>
          <div className="ml-2 hidden items-center gap-3 text-[10px] text-foreground-muted md:flex">
            {LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${item.color}`} />
                {item.label}
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <CliQuotaChip />
            <span
              data-testid="agent-console-attention-badge"
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                needing > 0
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {consoleAttentionBadge(needing)}
            </span>
            <button
              type="button"
              onClick={closeAgentConsole}
              aria-label="Close agent console"
              className="rounded p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <AuricIcon name="close" aria-hidden="true" className="text-[18px]" />
            </button>
          </div>
        </div>

        {focusedAgent ? (
          <FocusView
            agent={focusedAgent}
            otherAgents={agents.filter((agent) => agent.id !== focusedAgent.id)}
            reviewedAgentIds={reviewedAgentIds}
            agentEvents={agentEvents}
            agentHeartbeat={agentHeartbeat}
            onBack={() => setFocusedAgentId(null)}
            onFocus={setFocusedAgentId}
          />
        ) : sortedActive.length === 0 && idleProjects.length === 0 ? (
          // Nothing running and no starred project to list either (browser
          // mode, fresh install): the grid would otherwise be a blank canvas
          // between the header and the activity feed.
          <div
            data-testid="agent-console-empty"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center"
          >
            <h2 className="text-sm font-semibold text-foreground">No agents running</h2>
            <p className="max-w-xs text-[11px] text-foreground-muted">
              Start an agent from a project&apos;s context menu or the Agents panel.
            </p>
            <button
              type="button"
              onClick={() => setSpawnDialogOpen(true)}
              className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light transition-colors hover:bg-primary/20"
            >
              Start agent
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}
            >
              {sortedActive.map((repoPath) => (
                <ProjectSection
                  key={repoPath}
                  repoPath={repoPath}
                  agents={grouped[repoPath]}
                  {...sectionProps}
                />
              ))}
            </div>

            {idleProjects.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">
                  No agents running
                </h2>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
                >
                  {idleProjects.map((project) => (
                    <ProjectSection
                      key={project.path}
                      repoPath={project.path}
                      agents={[]}
                      {...sectionProps}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-shrink-0 items-center justify-end border-t border-white/10 px-3 py-0.5">
          <span className="text-[10px] text-foreground-muted/60">
            {focusedAgent
              ? 'Esc returns to the project grid'
              : 'Right-click a project to spawn · Esc closes'}
          </span>
        </div>
        <div className="h-[168px] flex-shrink-0 border-t border-white/10 bg-[#0a0a10]">
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}

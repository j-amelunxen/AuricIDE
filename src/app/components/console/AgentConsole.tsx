'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { groupAgentsByRepo } from '@/lib/store/agentSlice';
import { consoleAgentState } from '@/lib/agents/consoleState';
import { consoleSummaryLine, consoleAttentionBadge } from '@/lib/agents/consoleSummary';
import { countNeedingAttention, withReviewFlags } from '@/lib/agents/attention';
import { useNow } from '@/lib/hooks/useNow';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { fleetHeartbeatMax, heartbeatSeries } from '@/lib/agents/events/heartbeat';
import {
  isConsoleNavKey,
  isTypingTarget,
  nextCardIndex,
  type ConsoleCardRef,
} from '@/lib/agents/consoleKeyboard';
import {
  CONSOLE_FEED_MIN_HEIGHT,
  clampFeedHeight,
  feedHeightForKey,
  maxFeedHeight,
  readFeedHeight,
  readProjectsCollapsed,
  writeFeedHeight,
  writeProjectsCollapsed,
} from '@/lib/agents/consoleLayout';
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

  // The divider between the grid and the feed. `heightRef` shadows the state
  // because a drag reads the current height from listeners bound once per
  // gesture — a captured state value would be the height the drag started at,
  // and every mousemove would jump back to it.
  const [feedHeight, setFeedHeight] = useState(readFeedHeight);
  const heightRef = useRef(feedHeight);
  const applyFeedHeight = useCallback((height: number) => {
    heightRef.current = height;
    setFeedHeight(height);
  }, []);

  const [projectsCollapsed, setProjectsCollapsed] = useState(readProjectsCollapsed);
  const toggleProjects = () => {
    const next = !projectsCollapsed;
    setProjectsCollapsed(next);
    writeProjectsCollapsed(next);
  };

  // A height remembered on a larger monitor has to fit this one. Not written
  // back: making the window smaller for an hour should not cost the height the
  // user picked on the bigger screen. The measurement is kept in state as well
  // as applied, because it is also what the handle reports as its range.
  const [viewportHeight, setViewportHeight] = useState(0);
  useEffect(() => {
    const fit = () => {
      setViewportHeight(window.innerHeight);
      applyFeedHeight(clampFeedHeight(heightRef.current, window.innerHeight));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [applyFeedHeight]);

  const releaseDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseDrag.current?.(), []);

  const startFeedDrag = useCallback(
    (event: React.MouseEvent) => {
      // Otherwise the gesture selects the feed's text on the way up.
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = heightRef.current;

      const onMove = (move: MouseEvent) => {
        // The handle is the feed's top edge: dragging up grows it.
        applyFeedHeight(clampFeedHeight(startHeight + (startY - move.clientY), window.innerHeight));
      };
      const stop = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', stop);
        document.body.style.removeProperty('cursor');
        releaseDrag.current = null;
        writeFeedHeight(heightRef.current);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', stop);
      // The pointer leaves the 6px handle within the first few pixels of the
      // drag; without this the cursor flickers through whatever it passes over.
      document.body.style.cursor = 'row-resize';
      releaseDrag.current = stop;
    },
    [applyFeedHeight]
  );

  const onFeedHandleKey = useCallback(
    (event: React.KeyboardEvent) => {
      const next = feedHeightForKey(event.key, heightRef.current, window.innerHeight);
      if (next === null) return;
      event.preventDefault();
      applyFeedHeight(next);
      writeFeedHeight(next);
    },
    [applyFeedHeight]
  );

  const feedHeightCeiling = maxFeedHeight(viewportHeight);

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
  const loadAgentLogHistory = useStore((s) => s.loadAgentLogHistory);

  // Read once per opening, not on a timer: the stored history is by definition
  // the part that is no longer changing, and the live feed already covers what
  // is. A no-op while persistence is off.
  useEffect(() => {
    void loadAgentLogHistory();
  }, [loadAgentLogHistory]);

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

  // Read from the DOM rather than recomputed from state: the grid's visual
  // order is the product of two sorts (projects by attention, cards by state
  // inside each), and a second derivation of it here could drift from what
  // the reader actually sees.
  const gridRef = useRef<HTMLDivElement>(null);
  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const grid = gridRef.current;
      if (!grid) return;
      const elements = Array.from(grid.querySelectorAll<HTMLElement>('[data-console-card]'));
      if (elements.length === 0) return;

      const activeCard =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>('[data-console-card]')
          : null;
      const current = activeCard ? elements.indexOf(activeCard) : -1;

      if (isConsoleNavKey(event.key)) {
        const cards: ConsoleCardRef[] = elements.map((el) => ({
          agentId: el.dataset.agentId ?? '',
          repoPath: el.dataset.repoPath ?? '',
        }));
        const target = nextCardIndex(cards, current, event.key);
        // Arrows scroll the grid by default; once they mean "move focus" here
        // they must not do both.
        event.preventDefault();
        if (target !== null) elements[target].focus();
        return;
      }

      // Everything below acts on the focused card, so without one there is
      // nothing to act on — and the keystroke belongs to whatever else has focus.
      if (!activeCard) return;
      const agentId = activeCard.dataset.agentId;
      if (!agentId) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        setFocusedAgentId(agentId);
      } else if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        onOpenTerminal(agentId);
      }
    },
    [onOpenTerminal]
  );

  // One scale for every card in the console. Computed here rather than in
  // each section because comparing two agents across projects is exactly what
  // the chart is for, and a per-card scale makes that impossible.
  const heartbeatScaleMax = useMemo(
    () => fleetHeartbeatMax(agents.map((a) => heartbeatSeries(agentHeartbeat[a.id] ?? [], now))),
    [agents, agentHeartbeat, now]
  );

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
    heartbeatScaleMax,
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
        data-testid="agent-console-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-console-title"
        // Explicit rows, not nested flex: only the middle row may grow, so a
        // tall fleet can never push the activity feed past the window edge.
        className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        <div
          data-testid="agent-console-header"
          data-tauri-drag-region
          // titleBarStyle is "Overlay", so the traffic lights float over this
          // row's top-left — `--titlebar-gutter` is the room they need, the
          // same reservation `Header.tsx` makes.
          className="flex min-w-0 items-center gap-3 border-b border-white/10 py-2 pr-4 pl-[calc(1rem+var(--titlebar-gutter,0px))]"
        >
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
          <div
            ref={gridRef}
            onKeyDown={handleGridKeyDown}
            className="min-h-0 overflow-y-auto px-4 py-3"
          >
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
                {/* Foldable, because a long starred list is a wall of tiles
                    between the fleet and the feed on every open. The heading
                    stays either way — a fold nobody can find is a deletion. */}
                <h2 className="mb-2 mt-6 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">
                  <button
                    type="button"
                    onClick={toggleProjects}
                    aria-expanded={!projectsCollapsed}
                    className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-widest transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    <AuricIcon
                      name="expand_more"
                      aria-hidden="true"
                      className={`text-sm transition-transform ${projectsCollapsed ? '-rotate-90' : ''}`}
                    />
                    No agents running
                  </button>
                  {/* Folding hides tiles, never facts. */}
                  {projectsCollapsed && (
                    <span
                      data-testid="agent-console-idle-count"
                      className="rounded-full bg-white/5 px-1.5 tabular-nums"
                    >
                      {idleProjects.length}
                    </span>
                  )}
                </h2>
                {!projectsCollapsed && (
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
                )}
              </>
            )}
          </div>
        )}

        <div
          data-testid="agent-console-feed"
          style={{ height: feedHeight }}
          className="flex min-h-0 flex-col bg-[#0a0a10]"
        >
          {/* The console's own border-top, made draggable. A separator rather
              than a button: it has a value, and screen readers announce it as
              something with a range instead of something to press. */}
          <div
            data-testid="agent-console-feed-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the activity feed"
            aria-valuenow={feedHeight}
            aria-valuemin={CONSOLE_FEED_MIN_HEIGHT}
            aria-valuemax={Number.isFinite(feedHeightCeiling) ? feedHeightCeiling : undefined}
            tabIndex={0}
            onMouseDown={startFeedDrag}
            onKeyDown={onFeedHandleKey}
            className="group h-1.5 flex-shrink-0 cursor-row-resize border-t border-white/10 outline-none transition-colors hover:border-primary/60 hover:bg-primary/20 focus-visible:border-primary focus-visible:bg-primary/20"
          >
            {/* The grip only appears on hover or focus: at rest the divider
                should read as the border it already was. */}
            <div
              aria-hidden="true"
              className="mx-auto mt-0.5 h-0.5 w-8 rounded-full bg-white/25 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </div>
          <div className="min-h-0 flex-1">
            <ActivityFeed
              hint={
                focusedAgent
                  ? 'Esc returns to the project grid'
                  : 'Right-click a project to spawn · Esc closes'
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

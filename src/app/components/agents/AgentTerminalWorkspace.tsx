'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { loadAppConfig } from '@/lib/config/appConfig';
import { distinctStreamColors, supervisorFamilyColors } from '@/lib/agents/streamColors';
import { useNow } from '@/lib/hooks/useNow';
import { useAltHeld } from '@/lib/hooks/useAltHeld';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { isAgentLive } from '@/lib/agents/liveness';
import { hasTerminal, isFinishedAgent, splitTerminalAgents } from '@/lib/agents/fleet';
import { agentState, agentStateLabel } from '@/lib/agents/state';
import { supervisorFamilyRoots } from '@/lib/agents/supervisorFamily';
import { buildSupervisorTimeline, type TimelineRangeId } from '@/lib/agents/supervisorTimeline';
import { groupAgentTabs, type AgentTabGroup } from '@/lib/agents/tabGroups';
import {
  autoPlace,
  isSplit,
  paneLayout,
  placeAgent,
  PRESET_PANES,
  presetGrid,
  presetOrder,
  reconcileGrid,
  removeAgent,
  showAgent,
  singleGrid,
  type DropZone,
  type GridCells,
  type PresetPanes,
} from '@/lib/agents/terminalGrid';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ComboProgressBadge } from './ComboProgressBadge';
import { SupervisorTimelinePanel, SupervisorTimelineToggle } from './SupervisorTimeline';
import { AgentTab } from './AgentTab';
import type { AgentXtermHandle } from './AgentXterm';
import { TerminalGrid } from './TerminalGrid';
import { useTabGridDrag } from './useTabGridDrag';

/** Extra attributes for the header row, e.g. a window drag region or a left gutter. */
type HeaderProps = HTMLAttributes<HTMLDivElement> & {
  [attribute: `data-${string}`]: string | boolean | undefined;
};

interface AgentTerminalWorkspaceProps {
  agent: AgentInfo;
  /**
   * All active agents — when provided, the workspace shows a tab per agent for
   * fast switching. Headless ones get no tab; the header only counts them.
   */
  agents?: AgentInfo[];
  onSwitchAgent?: (agent: AgentInfo) => void;
  /** The last tab was closed, or the shell's close control was used. */
  onClose: () => void;
  onSelectionSpawn?: (selection: string) => void;
  /**
   * Asks "Stop this agent?". The shell owns the dialog and renders it, so a
   * question the shell asks afterwards (the merge offer) is on the same stack.
   */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /**
   * Does the actual ending. Called once, after the stop question was answered
   * and the dying tab was left.
   */
  onEndAgent?: (target: AgentInfo) => void | Promise<void>;
  /** Which tabs get an end control. Absent: every tab, as long as onEndAgent is given. */
  canEndAgent?: (target: AgentInfo) => boolean;
  /** Saves what the active terminal shows. readScreen answers null while the terminal is still opening. */
  onSaveScreen?: (agentName: string, readScreen: () => string | null) => Promise<void>;
  /** The active agent's last error line, pinned above the terminal. */
  errorDigest?: string | null;
  /** Rendered in the header's right cluster, before the close control. */
  headerActions?: ReactNode;
  /** Label and tooltip of the close control. Null leaves it out — a window has its own. */
  closeLabel?: string | null;
  /** The id of the heading that names the agent, for a shell's aria-labelledby. */
  titleId?: string;
  headerProps?: HeaderProps;
}

/**
 * The tab to land on after one is closed — the next one, or the previous at
 * the end. Takes the agents in the order the strip draws them, not the order
 * the fleet arrives in.
 */
function neighborIn(agents: AgentInfo[], closingId: string): AgentInfo | null {
  const idx = agents.findIndex((a) => a.id === closingId);
  const remaining = agents.filter((a) => a.id !== closingId);
  if (remaining.length === 0) return null;
  if (idx < 0) return remaining[0];
  return remaining[Math.min(idx, remaining.length - 1)];
}

/**
 * Stays inside the closed tab's group while it has others — the last child of
 * a supervisor family lands on its sibling, not on the next family — and only
 * then moves on along the whole strip.
 */
function neighborAfterClose(groups: AgentTabGroup[], closingId: string): AgentInfo | null {
  const group = groups.find((g) => g.agents.some((a) => a.id === closingId));
  return (
    (group && neighborIn(group.agents, closingId)) ??
    neighborIn(
      groups.flatMap((g) => g.agents),
      closingId
    )
  );
}

/**
 * Which agents the terminal area shows, and the moves that change it. The
 * stored grid is read against the live fleet every time, so an agent that
 * ended simply gives its pane up.
 */
function useTerminalGrid(
  agent: AgentInfo,
  agents: AgentInfo[] | undefined,
  onSwitchAgent: ((agent: AgentInfo) => void) | undefined
) {
  const stored = useStore((s) => s.terminalGridCells);
  const setStored = useStore((s) => s.setTerminalGridCells);
  const cells = useMemo(
    () =>
      reconcileGrid(
        stored,
        (agents ?? []).map((a) => a.id),
        agent.id
      ),
    [stored, agents, agent.id]
  );

  // An agent that appears while this is open takes a free quadrant by itself
  // (see `autoPlace`). Only the arrival decides: a split taken apart on
  // purpose stays apart, and opening the modal rearranges nothing.
  const agentIds = (agents ?? []).map((a) => a.id).join('\n');
  const knownIds = useRef(new Set(agentIds ? agentIds.split('\n') : []));
  useEffect(() => {
    const ids = agentIds ? agentIds.split('\n') : [];
    const arrived = ids.filter((id) => !knownIds.current.has(id));
    const before = ids.filter((id) => knownIds.current.has(id));
    knownIds.current = new Set(ids);
    if (arrived.length === 0 || before.length === 0) return;
    if (!loadAppConfig().agentTerminalAutoArrange) return;
    const anchor = before.includes(agent.id) ? agent.id : before[0];
    const next = arrived.reduce(
      (grid, id) => autoPlace(grid, id),
      reconcileGrid(stored, before, anchor)
    );
    if (isSplit(next)) setStored(next);
  }, [agentIds, agent.id, stored, setStored]);

  const apply = useCallback(
    (next: GridCells | null, activeId: string) => {
      setStored(next && isSplit(next) ? next : null);
      const target = activeId === agent.id ? null : agents?.find((a) => a.id === activeId);
      if (target) onSwitchAgent?.(target);
    },
    [agent.id, agents, onSwitchAgent, setStored]
  );

  /** A tab was chosen: an agent already on screen gets the focus, any other takes the focused pane. */
  const show = useCallback(
    (agentId: string) => apply(showAgent(cells, agent.id, agentId), agentId),
    [agent.id, apply, cells]
  );
  const place = useCallback(
    (agentId: string, zone: DropZone) => {
      // Whoever the dragged terminal leaves room for: the tabs after it, wrapping round.
      const ids = (agents ?? []).map((a) => a.id);
      const at = ids.indexOf(agentId);
      const spare = at < 0 ? ids : [...ids.slice(at + 1), ...ids.slice(0, at)];
      apply(placeAgent(cells, agentId, zone, spare), agentId);
    },
    [agents, apply, cells]
  );
  const remove = useCallback(
    (agentId: string) => {
      const next = removeAgent(cells, agentId);
      apply(next, next && agentId === agent.id ? next[0] : agent.id);
    },
    [agent.id, apply, cells]
  );

  /** A layout button: supervisors, then the other tabs in strip order, fill the panes. */
  const arrange = useCallback(
    (orderedIds: readonly string[], panes: PresetPanes) => {
      const next = presetGrid(orderedIds, panes);
      if (!next) return;
      apply(next, next.includes(agent.id) ? agent.id : next[0]);
    },
    [agent.id, apply]
  );

  return { cells, show, place, remove, arrange };
}

/** A small drawing of the preset itself, so the button shows what it will do. */
function PresetGlyph({ panes }: { panes: PresetPanes }) {
  const layout = paneLayout(presetGrid(['1', '2', '3', '4'], panes) ?? singleGrid('1'));
  return (
    <svg viewBox="0 0 16 12" aria-hidden="true" className="h-3 w-4">
      {layout.map((pane) => (
        <rect
          key={pane.agentId}
          x={(pane.col - 1) * 8 + 0.75}
          y={(pane.row - 1) * 6 + 0.75}
          width={pane.colSpan * 8 - 1.5}
          height={pane.rowSpan * 6 - 1.5}
          rx={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
        />
      ))}
    </svg>
  );
}

/** Two, three or four panes in one click, supervisors first, then the front of the tab strip. */
function LayoutPresets({
  agentCount,
  onArrange,
}: {
  agentCount: number;
  onArrange: (panes: PresetPanes) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Terminal layout"
      className="flex items-center gap-0.5 rounded-lg border border-white/10 p-0.5"
    >
      {PRESET_PANES.map((panes) => {
        const label = `Show ${panes} terminals side by side, supervisors first`;
        const enough = agentCount >= panes;
        return (
          <button
            key={panes}
            type="button"
            onClick={() => onArrange(panes)}
            disabled={!enough}
            aria-label={label}
            title={enough ? label : `Needs ${panes} agents — ${agentCount} open`}
            className="rounded-md p-1.5 text-foreground-muted transition-all hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
          >
            <PresetGlyph panes={panes} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * How many headless agents are still at work, and which. They have no terminal
 * to show, so this is all the view says about them; the names are a hover away.
 */
function HeadlessMarker({ agents }: { agents: AgentInfo[] }) {
  const names = agents.map((a) => a.name).join(', ');
  return (
    <span
      data-testid="headless-agents-marker"
      tabIndex={0}
      aria-label={`${agents.length} headless ${agents.length === 1 ? 'agent' : 'agents'} running: ${names}`}
      className="group/headless relative flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-foreground-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <AuricIcon name="visibility_off" aria-hidden="true" className="text-sm" />
      <span aria-hidden="true" className="tabular-nums">
        {agents.length} headless
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-10 mt-1.5 hidden min-w-[10rem] max-w-xs flex-col gap-0.5 rounded-lg border border-white/10 bg-[#0b0b18] px-2.5 py-2 text-[11px] text-foreground shadow-xl group-hover/headless:flex group-focus-visible/headless:flex"
      >
        {agents.map((a) => (
          <span key={a.id} className="truncate">
            {a.name}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * The agent terminals without a shell around them: header, tab strip and the
 * terminal grid. It fills whatever contains it and reads nothing that belongs
 * to a project — ending an agent, saving a screen and the error line all come
 * in through props, because a window without a project shows this too.
 */
export function AgentTerminalWorkspace({
  agent,
  agents: allAgents,
  onSwitchAgent,
  onClose,
  onSelectionSpawn,
  confirm,
  onEndAgent,
  canEndAgent,
  onSaveScreen,
  errorDigest = null,
  headerActions,
  closeLabel = 'Close',
  titleId,
  headerProps,
}: AgentTerminalWorkspaceProps) {
  // Headless agents leave the view entirely: no tab, no pane, no part in the
  // layout presets or the auto-arrange of new arrivals.
  const terminalSplit = useMemo(
    () => (allAgents ? splitTerminalAgents(allAgents) : null),
    [allAgents]
  );
  const agents = terminalSplit?.withTerminal;
  const headlessRunning = terminalSplit?.headlessRunning ?? [];
  const terminals = useRef(new Map<string, AgentXtermHandle>());
  const registerTerminal = useCallback((agentId: string, handle: AgentXtermHandle | null) => {
    if (handle) terminals.current.set(agentId, handle);
    else terminals.current.delete(agentId);
  }, []);
  const areaRef = useRef<HTMLDivElement>(null);
  const grid = useTerminalGrid(agent, agents, onSwitchAgent);
  // View state only: which pane is laid over the split for a closer look.
  // It lapses by itself once that pane is no longer part of a split.
  const [maximizedPick, setMaximizedPick] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineRange, setTimelineRange] = useState<TimelineRangeId>('30m');
  const { place } = grid;
  const dropOnGrid = useCallback(
    (agentId: string, zone: DropZone) => {
      // A drop rearranges the layout, so the layout is what is shown again.
      setMaximizedPick(null);
      place(agentId, zone);
    },
    [place]
  );
  const tabDrag = useTabGridDrag(areaRef, dropOnGrid);
  const maximizedId =
    maximizedPick && isSplit(grid.cells) && grid.cells.includes(maximizedPick)
      ? maximizedPick
      : null;
  const tabStripRef = useRef<HTMLDivElement>(null);
  // A maximized pane is a closer look, not a mode: pressing anywhere else
  // (another pane underneath, the header, the grid's gutter) ends it. The tab
  // strip decides per tab instead, so the maximized agent's own tab keeps it.
  const leaveMaximizeOutside = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!maximizedId || !(event.target instanceof Element)) return;
      if (event.target.closest('[data-maximized="true"]')) return;
      if (tabStripRef.current?.contains(event.target)) return;
      setMaximizedPick(null);
    },
    [maximizedId]
  );
  const { show } = grid;
  const toggleMaximize = useCallback(
    (agentId: string) => {
      setMaximizedPick(maximizedId === agentId ? null : agentId);
      show(agentId);
    },
    [maximizedId, show]
  );
  // A pane that is already open does not remount when it becomes the active
  // one, so the keyboard has to be handed over.
  useEffect(() => {
    terminals.current.get(agent.id)?.focus();
  }, [agent.id]);
  const savingScreen = useRef(false);

  // One project is not a grouping: with the whole fleet in one repository the
  // heading says nothing every tab does not already imply, so it stays away.
  const tabGroups = useMemo(() => groupAgentTabs(agents ?? []), [agents]);
  const showTabGroupLabels = tabGroups.length > 1;
  // Grouping reorders the strip, so "the tab beside this one" has to be read
  // off the strip — the raw list would send the user to another project.
  const tabOrder = useMemo(() => tabGroups.flatMap((group) => group.agents), [tabGroups]);
  // The project name a repo group would print, so a pane says where its agent
  // works — also inside a supervisor family, whose group spans repositories.
  const projectLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const group of groupAgentTabs(agents ?? [], { families: false })) {
      if (group.repoPath === null) continue;
      for (const a of group.agents) labels[a.id] = group.label;
    }
    return labels;
  }, [agents]);

  const splitView = isSplit(grid.cells);
  const markers = useStore((s) => s.agentColors);
  // A supervisor family always wears its colour: which child belongs to which
  // supervisor is a standing question once several run. Everything else is a
  // lookup: per-agent colours show while Alt is held, so the panes stay calm
  // until the user asks who is who. One agent has no one to be told apart
  // from, so it would only be noise there.
  const altHeld = useAltHeld();
  const familyColors = useMemo(
    () => supervisorFamilyColors(agents ?? [], markers),
    [agents, markers]
  );
  const accents = useMemo(
    () =>
      altHeld && (agents?.length ?? 0) > 1
        ? distinctStreamColors(
            (agents ?? []).map((a) => a.id),
            markers
          )
        : familyColors,
    [agents, markers, altHeld, familyColors]
  );

  const canEnd = useCallback(
    (target: AgentInfo) => !!onEndAgent && (canEndAgent?.(target) ?? true),
    [canEndAgent, onEndAgent]
  );

  const closeTab = useCallback(
    async (target: AgentInfo) => {
      if (!onEndAgent || !canEnd(target)) return;

      if (!isFinishedAgent(target) && target.status === 'running') {
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
        const next = neighborAfterClose(tabGroups, target.id);
        if (next) onSwitchAgent?.(next);
        else onClose();
      }

      await onEndAgent(target);
    },
    [agent.id, tabGroups, canEnd, confirm, onClose, onEndAgent, onSwitchAgent]
  );

  const saveVisibleScreen = useCallback(() => {
    if (!onSaveScreen || savingScreen.current) return;
    savingScreen.current = true;
    void onSaveScreen(
      agent.name,
      () => terminals.current.get(agent.id)?.visibleText() ?? null
    ).finally(() => {
      savingScreen.current = false;
    });
  }, [agent.id, agent.name, onSaveScreen]);

  const openTimelineAgent = useCallback(
    (target: AgentInfo) => {
      if (!hasTerminal(target) || target.id === agent.id) return;
      onSwitchAgent?.(target);
    },
    [agent.id, onSwitchAgent]
  );

  const now = useNow();
  const state = agentState(agent, now);
  // The chart reads the whole fleet, headless runs included. The tab strip
  // hides those on purpose; they are still agents this supervisor started.
  const timeline = useMemo(() => {
    const fleet = allAgents ?? [agent];
    const root = supervisorFamilyRoots(fleet).get(agent.id);
    return root ? buildSupervisorTimeline(fleet, root, now, timelineRange) : null;
  }, [agent, allAgents, now, timelineRange]);

  const isRunning = agent.status === 'running';
  const isLive = isAgentLive(agent, now);

  return (
    <div
      onMouseDownCapture={leaveMaximizeOutside}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
    >
      {/* Header */}
      <div
        {...headerProps}
        className={`flex items-center gap-3 px-5 py-3 border-b border-white/10 glass flex-shrink-0 ${headerProps?.className ?? ''}`.trimEnd()}
      >
        <div className="flex min-w-0 items-center gap-3">
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
              <h2 id={titleId} className="text-sm font-bold text-foreground">
                {agent.name}
              </h2>
              <ComboProgressBadge agentId={agent.id} />
              <span
                className={`text-[9px] font-black uppercase tracking-widest ${isRunning ? 'text-primary' : 'text-foreground-muted'}`}
              >
                {agentStateLabel(state, agent.headless)}
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

        {timeline && (
          <div className="flex min-w-0 flex-1 items-center justify-end">
            <SupervisorTimelineToggle
              open={timelineOpen}
              runningCount={timeline.runningCount}
              onToggle={() => setTimelineOpen((open) => !open)}
            />
          </div>
        )}

        <div className={`flex shrink-0 items-center gap-2 ${timeline ? '' : 'ml-auto'}`}>
          {headlessRunning.length > 0 && <HeadlessMarker agents={headlessRunning} />}
          {(agents?.length ?? 0) > 1 && (
            <LayoutPresets
              agentCount={agents?.length ?? 0}
              onArrange={(panes) => grid.arrange(presetOrder(tabOrder), panes)}
            />
          )}
          <span className="font-mono text-[9px] text-foreground-muted opacity-40">{agent.id}</span>
          {headerActions}
          {closeLabel !== null && (
            <button
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
              className="rounded-lg p-2 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
            >
              <AuricIcon name="close" className="text-lg" />
            </button>
          )}
        </div>
      </div>

      {timelineOpen && timeline && (
        <SupervisorTimelinePanel
          model={timeline}
          range={timelineRange}
          onRange={setTimelineRange}
          now={now}
          currentAgentId={agent.id}
          onOpenAgent={openTimelineAgent}
        />
      )}

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
          ref={tabStripRef}
          role="tablist"
          aria-label="Active agents"
          className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-black/40 overflow-x-auto no-scrollbar flex-shrink-0"
        >
          {tabGroups.map((group, groupIndex) => {
            // A family's edge is its colour, so the group reads as one even
            // when Alt has switched the tabs to per-agent colours.
            const familyAccent = group.supervisorId ? familyColors[group.supervisorId] : undefined;
            return (
              <div
                key={group.key}
                data-testid={`agent-tab-group-${group.key}`}
                data-accent={familyAccent}
                style={{
                  flexGrow: group.agents.length,
                  flexShrink: 0,
                  flexBasis: 0,
                  minWidth: showTabGroupLabels
                    ? `calc(${group.agents.length} * 10rem + 8rem)`
                    : `calc(${group.agents.length} * 10rem)`,
                  ...(familyAccent ? { borderLeftColor: familyAccent } : {}),
                }}
                className={`flex items-center gap-1 overflow-hidden ${
                  familyAccent
                    ? `border-l-2 pl-2 ${groupIndex > 0 ? 'ml-1' : ''}`
                    : groupIndex > 0
                      ? 'ml-1 border-l border-white/10 pl-2'
                      : ''
                }`}
              >
                {showTabGroupLabels && (
                  <span
                    title={
                      group.supervisorId
                        ? `${group.label} and the agents it started`
                        : (group.repoPath ?? undefined)
                    }
                    className="mr-0.5 max-w-[120px] flex-shrink-0 truncate text-[8px] font-black uppercase tracking-widest text-foreground-muted/70"
                  >
                    {group.label}
                  </span>
                )}
                {group.agents.map((a) => {
                  const isActive = a.id === agent.id;
                  return (
                    <AgentTab
                      key={a.id}
                      agent={a}
                      isActive={isActive}
                      now={now}
                      onSelect={() => {
                        if (tabDrag.consumeClick()) return;
                        if (maximizedId && a.id !== maximizedId) setMaximizedPick(null);
                        grid.show(a.id);
                      }}
                      onDragStart={
                        (agents?.length ?? 0) > 1
                          ? (event) => tabDrag.begin(a.id, event)
                          : undefined
                      }
                      accent={accents[a.id]}
                      inView={splitView && grid.cells.includes(a.id)}
                      onEnd={canEnd(a) ? () => void closeTab(a) : undefined}
                      onSaveScreen={isActive && onSaveScreen ? saveVisibleScreen : undefined}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* xterm.js terminals — one, or up to four side by side */}
      <TerminalGrid
        cells={grid.cells}
        activeId={agent.id}
        agents={agents ?? [agent]}
        projects={projectLabels}
        areaRef={areaRef}
        drag={tabDrag.drag}
        onFocusPane={grid.show}
        onDragPane={(agents?.length ?? 0) > 1 ? tabDrag.begin : undefined}
        maximizedId={maximizedId}
        onToggleMaximize={toggleMaximize}
        onRemovePane={grid.remove}
        accents={accents}
        canEndPane={canEnd}
        onEndPane={(target) => void closeTab(target)}
        registerTerminal={registerTerminal}
        onSelectionSpawn={onSelectionSpawn}
      />
    </div>
  );
}

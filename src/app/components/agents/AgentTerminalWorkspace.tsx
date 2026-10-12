'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { isAgentLive } from '@/lib/agents/liveness';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { agentState, agentStateLabel } from '@/lib/agents/state';
import { groupAgentTabs } from '@/lib/agents/tabGroups';
import {
  isSplit,
  placeAgent,
  reconcileGrid,
  removeAgent,
  showAgent,
  type DropZone,
  type GridCells,
} from '@/lib/agents/terminalGrid';
import { UNGROUPED_REPO_KEY } from '@/lib/store/agentSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ComboProgressBadge } from './ComboProgressBadge';
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
  /** All active agents — when provided, the workspace shows a tab per agent for fast switching. */
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
function neighborAfterClose(agents: AgentInfo[], closingId: string): AgentInfo | null {
  const idx = agents.findIndex((a) => a.id === closingId);
  const remaining = agents.filter((a) => a.id !== closingId);
  if (remaining.length === 0) return null;
  if (idx < 0) return remaining[0];
  return remaining[Math.min(idx, remaining.length - 1)];
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

  return { cells, show, place, remove };
}

/**
 * The agent terminals without a shell around them: header, tab strip and the
 * terminal grid. It fills whatever contains it and reads nothing that belongs
 * to a project — ending an agent, saving a screen and the error line all come
 * in through props, because a window without a project shows this too.
 */
export function AgentTerminalWorkspace({
  agent,
  agents,
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
  const terminals = useRef(new Map<string, AgentXtermHandle>());
  const registerTerminal = useCallback((agentId: string, handle: AgentXtermHandle | null) => {
    if (handle) terminals.current.set(agentId, handle);
    else terminals.current.delete(agentId);
  }, []);
  const areaRef = useRef<HTMLDivElement>(null);
  const grid = useTerminalGrid(agent, agents, onSwitchAgent);
  const tabDrag = useTabGridDrag(areaRef, grid.place);
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
        const next = neighborAfterClose(tabOrder, target.id);
        if (next) onSwitchAgent?.(next);
        else onClose();
      }

      await onEndAgent(target);
    },
    [agent.id, tabOrder, canEnd, confirm, onClose, onEndAgent, onSwitchAgent]
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

  const now = useNow();
  const state = agentState(agent, now);

  const isRunning = agent.status === 'running';
  const isLive = isAgentLive(agent, now);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <div
        {...headerProps}
        className={`flex items-center justify-between px-5 py-3 border-b border-white/10 glass flex-shrink-0 ${headerProps?.className ?? ''}`.trimEnd()}
      >
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

        <div className="flex items-center gap-2">
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
                return (
                  <AgentTab
                    key={a.id}
                    agent={a}
                    isActive={isActive}
                    now={now}
                    onSelect={() => {
                      if (!tabDrag.consumeClick()) grid.show(a.id);
                    }}
                    onDragStart={
                      (agents?.length ?? 0) > 1 ? (event) => tabDrag.begin(a.id, event) : undefined
                    }
                    onEnd={canEnd(a) ? () => void closeTab(a) : undefined}
                    onSaveScreen={isActive && onSaveScreen ? saveVisibleScreen : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* xterm.js terminals — one, or up to four side by side */}
      <TerminalGrid
        cells={grid.cells}
        activeId={agent.id}
        agents={agents ?? [agent]}
        areaRef={areaRef}
        drag={tabDrag.drag}
        onFocusPane={grid.show}
        onRemovePane={grid.remove}
        registerTerminal={registerTerminal}
        onSelectionSpawn={onSelectionSpawn}
      />
    </div>
  );
}

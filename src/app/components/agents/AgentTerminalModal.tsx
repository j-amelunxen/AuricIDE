'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { deriveErrorDigest } from '@/lib/agents/errorDigest';
import { attachAgentStream } from '@/lib/terminal/agentStream';
import { onAgentPtyResize } from '@/lib/terminal/agentMirror';
import { attachImagePaste, attachFileDrop } from '@/lib/terminal/imageInsert';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
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
import { accentColor, accentRgb } from '@/lib/theme/accent';
import { APP_CONFIG_CHANGED_EVENT, APP_CONFIG_KEYS, loadAppConfig } from '@/lib/config/appConfig';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ComboProgressBadge } from './ComboProgressBadge';
import { AgentTab } from './AgentTab';
import {
  TERMINAL_INTERACTION_OPTIONS,
  buildTerminalMenu,
  copyText,
  handleTerminalClipboardKey,
  readClipboardText,
  terminalMenuActions,
} from '@/lib/terminal/interactions';

const EMPTY_ERROR_LOGS: string[] = [];

interface AgentXtermProps {
  agentId: string;
  onSelectionSpawn?: (selection: string) => void;
}

function AgentXterm({ agentId, onSelectionSpawn }: AgentXtermProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectionSpawnRef = useRef(onSelectionSpawn);
  useEffect(() => {
    onSelectionSpawnRef.current = onSelectionSpawn;
  }, [onSelectionSpawn]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    options: ContextMenuOption[];
  } | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const setup = async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: loadAppConfig().agentTerminalFontSize,
        fontFamily: "'JetBrains Mono', monospace",
        theme: {
          background: '#050510',
          foreground: '#ffffff',
          cursor: accentColor(),
          selectionBackground: `rgba(${accentRgb()}, 0.4)`,
          black: '#000000',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#ffffff',
        },
        scrollback: 1000,
        ...TERMINAL_INTERACTION_OPTIONS,
      });
      term.attachCustomKeyEventHandler((event) => handleTerminalClipboardKey(event, term));

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      const applyFontSize = () => {
        term.options.fontSize = loadAppConfig().agentTerminalFontSize;
        try {
          fitAddon.fit();
        } catch {}
      };
      const onConfigChange = (event: Event) => {
        const key = (event as CustomEvent<{ key?: string }>).detail?.key;
        if (key === APP_CONFIG_KEYS.agentTerminalFontSize) applyFontSize();
      };
      window.addEventListener(APP_CONFIG_CHANGED_EVENT, onConfigChange);
      // Fit BEFORE attaching, and only attach once the layout has settled
      // (fit again after a frame): TUI agents redraw via cursor-relative
      // escape sequences, so writing the screen at one width and reflowing
      // it afterwards leaves duplicated fragments on screen.
      try {
        fitAddon.fit();
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (disposed || !containerRef.current) return;
      try {
        fitAddon.fit();
      } catch {}

      // Right-click: always show a clipboard menu. Spawn stays a bonus
      // when there is a selection — never the only entry, and never gated
      // on already having one (TUI mouse-tracking makes that a dead end).
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const selection = term.getSelection();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          options: terminalMenuActions(
            buildTerminalMenu(selection, !!onSelectionSpawnRef.current),
            {
              copy: () => {
                void copyText(selection);
              },
              paste: () => {
                void readClipboardText().then((text) => {
                  if (text) term.paste(text);
                });
              },
              selectAll: () => term.selectAll(),
              spawn: () => onSelectionSpawnRef.current?.(selection),
            }
          ),
        });
      };
      const host = containerRef.current;
      host.addEventListener('contextmenu', handleContextMenu);

      // Sync PTY + mirror to the settled size BEFORE attaching, so the
      // screen snapshot is laid out for the width it is displayed at.
      const { writeToShell, resizeShell } = await import('@/lib/tauri/terminal');
      const sessionId = `agent-${agentId}`;
      resizeShell(sessionId, term.rows, term.cols).catch(() => {});

      // Single source of truth: the store (see attachAgentStream). A second
      // Tauri event channel had an await gap between backfill and live
      // subscribe, so chunks got lost or shown twice.
      // Restoring a long-running agent means replaying its whole mirror screen,
      // which is not instant. Say so rather than showing a black rectangle —
      // but only once it is slow enough to notice, so the common case is quiet.
      const followRestore = (restored: Promise<void>) => {
        const slowEnoughToMention = setTimeout(() => setIsRestoring(true), 150);
        void restored.finally(() => {
          clearTimeout(slowEnoughToMention);
          setIsRestoring(false);
        });
      };

      const stream = attachAgentStream(term, agentId);
      let detachStream = stream.detach;
      followRestore(stream.restored);

      // Another view (the bottom terminal preview) may take the PTY geometry
      // over. Adopt it and redraw from a fresh mirror snapshot — keeping a
      // screen laid out for the old width produces scrambled fragments.
      const unsubPtyResize = onAgentPtyResize(agentId, ({ rows, cols }) => {
        if (term.rows === rows && term.cols === cols) return;
        detachStream();
        term.resize(cols, rows);
        term.reset();
        const reattached = attachAgentStream(term, agentId);
        detachStream = reattached.detach;
        followRestore(reattached.restored);
      });

      // Forward keyboard input to the agent PTY
      const sendText = (data: string) => {
        writeToShell(sessionId, data);
      };
      term.onData(sendText);

      // Warp-style image handling: pasting an image saves it to the app
      // cache and inserts its path; dropping files inserts their paths.
      const detachImagePaste = attachImagePaste(containerRef.current, sendText);
      // Dropping onto a terminal is asking to talk to it: focus follows the
      // inserted path, so the next keystroke — usually Enter — lands here.
      const detachFileDrop = attachFileDrop(containerRef.current, sendText, setIsDropTarget, () =>
        term.focus()
      );

      // Propagate xterm resize events to PTY backend
      term.onResize(({ rows, cols }) => {
        resizeShell(sessionId, rows, cols).catch(() => {});
      });

      // ResizeObserver triggers fitAddon.fit() on container size changes
      let resizeTimer: ReturnType<typeof setTimeout>;
      const resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          try {
            fitAddon.fit();
          } catch {}
        }, 50);
      });
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // Opening an agent is asking to talk to it. The dialog's generic focus
      // rule lands on the first button in the header, so without this the
      // first keystrokes go nowhere and the user has to click in first. This
      // runs after the dialog's own mount focus (setup is async), so it wins,
      // and it re-runs per agentId — switching tabs keeps the keyboard here.
      // A setup that lost its race (agent switched mid-await) must stay out of
      // it, or the terminal being torn down grabs focus from the new one.
      if (!disposed) term.focus();

      return () => {
        disposed = true;
        unsubPtyResize();
        detachStream();
        detachImagePaste();
        detachFileDrop();
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        host.removeEventListener('contextmenu', handleContextMenu);
        window.removeEventListener(APP_CONFIG_CHANGED_EVENT, onConfigChange);
        term.dispose();
      };
    };

    let sessionCleanup: (() => void) | undefined;
    let isMounted = true;

    setup()
      .then((c) => {
        if (!isMounted) {
          c?.();
        } else {
          sessionCleanup = c;
        }
      })
      .catch(() => {
        // Setup failure (browser/test mode) must not surface as unhandled
      });

    return () => {
      isMounted = false;
      disposed = true;
      sessionCleanup?.();
    };
  }, [agentId]);

  return (
    <>
      <div className="relative h-full w-full">
        <div ref={containerRef} data-testid="agent-xterm" className="h-full w-full" />
        {isRestoring && (
          <div
            data-testid="terminal-restoring"
            className="pointer-events-none absolute left-3 top-3 z-30 rounded-full bg-black/70 px-2.5 py-1 text-[10px] text-foreground-muted"
          >
            Restoring screen…
          </div>
        )}
        {isDropTarget && (
          <div
            data-testid="terminal-drop-overlay"
            className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center rounded-md border-2 border-primary/60 bg-primary/10"
          >
            <span className="rounded-full bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
              Drop to insert path
            </span>
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenu.options}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ── Agent tab state ────────────────────────────────────────────────

// ── Modal ──────────────────────────────────────────────────────────

interface AgentTerminalModalProps {
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
                // Grow with tab count so leftover strip width stays equal per tab.
                // minWidth is the floor (10rem/tab, plus the project label); past
                // that the strip scrolls instead of crushing names.
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

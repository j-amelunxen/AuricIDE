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
import { isAgentLive } from '@/lib/agents/liveness';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { agentState, type AgentState } from '@/lib/agents/state';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { accentColor, accentRgb } from '@/lib/theme/accent';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ComboProgressBadge } from './ComboProgressBadge';
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
        fontSize: 14,
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
      const detachFileDrop = attachFileDrop(containerRef.current, sendText, setIsDropTarget);

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

      return () => {
        disposed = true;
        unsubPtyResize();
        detachStream();
        detachImagePaste();
        detachFileDrop();
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        host.removeEventListener('contextmenu', handleContextMenu);
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

const TAB_STATE_STYLES: Record<AgentState, { dot: string; label: string }> = {
  working: { dot: 'bg-primary animate-pulse', label: 'text-primary' },
  waiting: { dot: 'bg-amber-400', label: 'text-amber-400' },
  'needs-input': { dot: 'bg-amber-300', label: 'text-amber-300' },
  stalled: { dot: 'bg-orange-300', label: 'text-orange-300' },
  done: { dot: 'bg-emerald-400', label: 'text-emerald-400' },
  error: { dot: 'bg-red-400', label: 'text-red-400' },
  queued: { dot: 'bg-foreground-muted', label: 'text-foreground-muted' },
};

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

/** The tab to land on after one is closed — the next one, or the previous at the end. */
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
  // The confirm dialog also handles Escape. A window listener that closed this
  // modal on the same key would take the terminal with the question.
  const confirmingRef = useRef(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmingRef.current) onClose();
    },
    [onClose]
  );

  const closeTab = useCallback(
    async (target: AgentInfo) => {
      const finished = isFinishedAgent(target);
      if (finished ? !onDismiss : !onKill) return;

      if (!finished && target.status === 'running') {
        confirmingRef.current = true;
        const go = await confirm({
          title: 'Stop this agent?',
          message: `Stop ${target.name}? Its work in progress is lost.`,
          confirmLabel: 'Stop',
        });
        confirmingRef.current = false;
        if (!go) return;
      }

      // Leave the dying tab before the process dies, so the screen does not
      // sit on a snapshot of an agent that is already gone.
      if (target.id === agent.id) {
        const next = neighborAfterClose(agents ?? [], target.id);
        if (next) onSwitchAgent?.(next);
        else onClose();
      }

      if (finished) onDismiss?.(target.id);
      else onKill?.(target.id);
    },
    [agent.id, agents, confirm, onClose, onDismiss, onKill, onSwitchAgent]
  );

  const now = useNow();

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
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
                  {agent.status}
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

        {/* Agent tabs — fast switching between active agents with state preview */}
        {agents && agents.length > 0 && (
          <div
            role="tablist"
            aria-label="Active agents"
            className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-black/40 overflow-x-auto no-scrollbar flex-shrink-0"
          >
            {agents.map((a) => {
              const isActive = a.id === agent.id;
              const state = agentState(a, now);
              const style = TAB_STATE_STYLES[state];
              const finished = isFinishedAgent(a);
              const canEnd = finished ? !!onDismiss : !!onKill;
              const endLabel = finished ? `Dismiss ${a.name}` : `Stop ${a.name}`;
              return (
                <div
                  key={a.id}
                  className={`group flex items-center rounded-lg border whitespace-nowrap transition-colors ${
                    isActive
                      ? 'border-primary/40 bg-primary/15 text-white'
                      : 'border-white/5 bg-white/[0.02] text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  <button
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`agent-tab-${a.id}`}
                    data-state={state}
                    onClick={() => {
                      if (!isActive) onSwitchAgent?.(a);
                    }}
                    onMouseDown={(e) => {
                      if (e.button === 1) e.preventDefault();
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        void closeTab(a);
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${style.dot}`}
                    />
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    <span className={`text-[8px] font-black tracking-widest ${style.label}`}>
                      {state}
                    </span>
                  </button>
                  {canEnd && (
                    <button
                      type="button"
                      data-testid={`agent-tab-close-${a.id}`}
                      aria-label={endLabel}
                      title={endLabel}
                      onClick={() => void closeTab(a)}
                      className={`mr-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-foreground-muted transition-[opacity,transform,color,background-color] hover:bg-red-500/15 hover:text-red-400 active:scale-[0.96] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/60 ${
                        isActive
                          ? 'opacity-70'
                          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                      }`}
                    >
                      <AuricIcon name="close" aria-hidden="true" className="text-[11px]" />
                    </button>
                  )}
                </div>
              );
            })}
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

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { attachAgentStream } from '@/lib/terminal/agentStream';
import { attachImagePaste, attachFileDrop } from '@/lib/terminal/imageInsert';
import { ContextMenu } from '../ide/ContextMenu';
import { useNow } from '@/lib/hooks/useNow';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { accentColor, accentRgb } from '@/lib/theme/accent';

interface AgentXtermProps {
  agentId: string;
  onSelectionSpawn?: (selection: string) => void;
}

function AgentXterm({ agentId, onSelectionSpawn }: AgentXtermProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    selection: string;
  } | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

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
      });

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

      // Right-click context menu for selection spawning
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const selection = term.getSelection();
        if (selection) {
          setContextMenu({ x: e.clientX, y: e.clientY, selection });
        }
      };
      containerRef.current.addEventListener('contextmenu', handleContextMenu);

      // Sync PTY + mirror to the settled size BEFORE attaching, so the
      // screen snapshot is laid out for the width it is displayed at.
      const { writeToShell, resizeShell } = await import('@/lib/tauri/terminal');
      const sessionId = `agent-${agentId}`;
      resizeShell(sessionId, term.rows, term.cols).catch(() => {});

      // Single source of truth: the store (see attachAgentStream). A second
      // Tauri event channel had an await gap between backfill and live
      // subscribe, so chunks got lost or shown twice.
      const unsubStore = attachAgentStream(term, agentId);

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
        unsubStore();
        detachImagePaste();
        detachFileDrop();
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        containerRef.current?.removeEventListener('contextmenu', handleContextMenu);
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
          options={[
            {
              label: 'Spawn Agent with Selection',
              icon: 'bolt',
              action: () => {
                onSelectionSpawn?.(contextMenu.selection);
                setContextMenu(null);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

// ── Agent tab state ────────────────────────────────────────────────

export type AgentTabState = 'working' | 'waiting' | 'done' | 'error' | 'queued';

// appendAgentLog throttles lastActivityAt bumps to one per 2s, so a 2s window
// would flicker for a continuously streaming agent — use a wider one.
const WORKING_WINDOW_MS = 5_000;

export function agentTabState(agent: AgentInfo, now: number): AgentTabState {
  switch (agent.status) {
    case 'running':
      return agent.lastActivityAt && now - agent.lastActivityAt < WORKING_WINDOW_MS
        ? 'working'
        : 'waiting';
    case 'idle':
      return 'done';
    case 'queued':
      return 'queued';
    default:
      return 'error';
  }
}

const TAB_STATE_STYLES: Record<AgentTabState, { dot: string; label: string }> = {
  working: { dot: 'bg-primary animate-pulse', label: 'text-primary' },
  waiting: { dot: 'bg-amber-400', label: 'text-amber-400' },
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
}

export function AgentTerminalModal({
  agent,
  agents,
  onSwitchAgent,
  onClose,
  onSelectionSpawn,
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
    />
  );
}

interface AgentTerminalDialogProps {
  agent: AgentInfo;
  agents?: AgentInfo[];
  onSwitchAgent?: (agent: AgentInfo) => void;
  onClose: () => void;
  onSelectionSpawn?: (selection: string) => void;
}

function AgentTerminalDialog({
  agent,
  agents,
  onSwitchAgent,
  onClose,
  onSelectionSpawn,
}: AgentTerminalDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  const now = useNow();

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isRunning = agent.status === 'running';
  const isLive = agent.lastActivityAt && now - agent.lastActivityAt < 2000;

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
              <span className="material-symbols-outlined text-lg text-foreground">terminal</span>
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
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* Agent tabs — fast switching between active agents with state preview */}
        {agents && agents.length > 0 && (
          <div
            role="tablist"
            aria-label="Active agents"
            className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-black/40 overflow-x-auto no-scrollbar flex-shrink-0"
          >
            {agents.map((a) => {
              const isActive = a.id === agent.id;
              const state = agentTabState(a, now);
              const style = TAB_STATE_STYLES[state];
              return (
                <button
                  key={a.id}
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`agent-tab-${a.id}`}
                  data-state={state}
                  onClick={() => {
                    if (!isActive) onSwitchAgent?.(a);
                  }}
                  className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all ${
                    isActive
                      ? 'border-primary/40 bg-primary/15 text-white'
                      : 'border-white/5 bg-white/[0.02] text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
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
              );
            })}
          </div>
        )}

        {/* xterm.js Terminal */}
        <div className="flex-1 min-h-0 p-2">
          <AgentXterm agentId={agent.id} onSelectionSpawn={onSelectionSpawn} />
        </div>
      </div>
    </div>
  );
}

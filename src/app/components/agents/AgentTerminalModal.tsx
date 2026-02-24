'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { ContextMenu } from '../ide/ContextMenu';
import { useNow } from '@/lib/hooks/useNow';

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
          cursor: '#bc13fe',
          selectionBackground: 'rgba(188, 19, 254, 0.4)',
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
      setTimeout(() => {
        try {
          fitAddon.fit();
        } catch {}
      }, 50);

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

      // Replay historical logs from the store
      const logs = useStore.getState().agentLogs[agentId] ?? [];
      for (const line of logs) {
        term.write(line);
      }

      // Subscribe to live PTY output
      const { onTerminalOut, resizeShell } = await import('@/lib/tauri/terminal');
      const sessionId = `agent-${agentId}`;
      const unsub = await onTerminalOut(sessionId, (data) => {
        if (!disposed) term.write(data);
      });

      // Forward keyboard input to the agent PTY
      const { writeToShell } = await import('@/lib/tauri/terminal');
      term.onData((data) => {
        writeToShell(sessionId, data);
      });

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

      // Send initial resize after fit
      resizeShell(sessionId, term.rows, term.cols).catch(() => {});

      return () => {
        disposed = true;
        unsub();
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        containerRef.current?.removeEventListener('contextmenu', handleContextMenu);
        term.dispose();
      };
    };

    let sessionCleanup: (() => void) | undefined;
    let isMounted = true;

    setup().then((c) => {
      if (!isMounted) {
        c?.();
      } else {
        sessionCleanup = c;
      }
    });

    return () => {
      isMounted = false;
      disposed = true;
      sessionCleanup?.();
    };
  }, [agentId]);

  return (
    <>
      <div ref={containerRef} data-testid="agent-xterm" className="h-full w-full" />
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

// ── Modal ──────────────────────────────────────────────────────────

interface AgentTerminalModalProps {
  agent: AgentInfo | null;
  onClose: () => void;
  onSelectionSpawn?: (selection: string) => void;
}

export function AgentTerminalModal({ agent, onClose, onSelectionSpawn }: AgentTerminalModalProps) {
  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  const now = useNow();

  useEffect(() => {
    if (!agent) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [agent, handleKeyDown]);

  if (!agent) return null;

  const isRunning = agent.status === 'running';
  const isLive = agent.lastActivityAt && now - agent.lastActivityAt < 2000;

  return (
    <div
      data-testid="agent-modal-backdrop"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
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
                <h2 className="text-sm font-bold text-foreground">{agent.name}</h2>
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

        {/* xterm.js Terminal */}
        <div className="flex-1 min-h-0 p-2">
          <AgentXterm agentId={agent.id} onSelectionSpawn={onSelectionSpawn} />
        </div>
      </div>
    </div>
  );
}

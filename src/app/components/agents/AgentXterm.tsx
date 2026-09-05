'use client';

import { useEffect, useRef, useState } from 'react';
import { attachAgentStream } from '@/lib/terminal/agentStream';
import { onAgentPtyResize } from '@/lib/terminal/agentMirror';
import { attachImagePaste, attachFileDrop } from '@/lib/terminal/imageInsert';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import { accentColor, accentRgb } from '@/lib/theme/accent';
import { APP_CONFIG_CHANGED_EVENT, APP_CONFIG_KEYS, loadAppConfig } from '@/lib/config/appConfig';
import {
  TERMINAL_INTERACTION_OPTIONS,
  buildTerminalMenu,
  copyText,
  handleTerminalClipboardKey,
  readClipboardText,
  terminalMenuActions,
} from '@/lib/terminal/interactions';

export interface AgentXtermProps {
  agentId: string;
  onSelectionSpawn?: (selection: string) => void;
}

export function AgentXterm({ agentId, onSelectionSpawn }: AgentXtermProps) {
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

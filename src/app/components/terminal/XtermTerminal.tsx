'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  spawnShell,
  writeToShell,
  resizeShell,
  onTerminalOut,
  onTerminalErr,
} from '@/lib/tauri/terminal';
import { getPromptTemplate, FALLBACK_PROMPT_TEMPLATE } from '@/lib/tauri/providers';
import { xtermMounted, xtermUnmounted } from '@/lib/metrics';
import { attachAgentStream } from '@/lib/terminal/agentStream';
import { createRenderKeepAlive } from '@/lib/terminal/renderKeepAlive';
import { accentColor, accentRgb } from '@/lib/theme/accent';

interface XtermTerminalProps {
  id: string; // Session ID (agent-id or 'main-terminal')
  cwd?: string; // Working directory
  initialCommand?: string; // e.g. /bin/zsh
  agentId?: string; // Agent mode: stream this agent's output from the store
  onInput?: (data: string) => void; // Custom input handler (e.g. sendToAgent)
}

export function XtermTerminal({ id, cwd, initialCommand, agentId, onInput }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const promptTemplateRef = useRef<string>(FALLBACK_PROMPT_TEMPLATE);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load prompt template from provider on mount
  useEffect(() => {
    getPromptTemplate()
      .then((template) => {
        promptTemplateRef.current = template;
      })
      .catch(() => {
        // Browser mode — keep fallback
      });
  }, []);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      scrollback: 1000,
      theme: {
        background: '#00000000', // Inherit from parent container
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
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    xtermMounted();

    // Flush xterm's rAF-driven render even when WKWebView parks the compositor
    // between interactions (otherwise new output only paints on the next input).
    const keepAlive = createRenderKeepAlive();
    const writeTerm = (data: string) => {
      term.write(data);
      keepAlive.nudge();
    };

    // Propagate xterm resize events to PTY backend (skip for agent tabs —
    // the fullscreen modal owns the agent PTY size)
    if (!agentId) {
      term.onResize(({ rows, cols }) => {
        resizeShell(id, rows, cols).catch(() => {});
      });
    }

    // ResizeObserver triggers fitAddon.fit() on container size changes
    let resizeTimer: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {}
      }, 50);
    });
    resizeObserver.observe(containerRef.current);

    // Intercept CMD+I to insert provider prompt template.
    // Flags go before -p so the cursor lands right after the opening quote —
    // no escape-sequence cursor movement needed, which avoids readline redraw bugs.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown' && event.metaKey && event.key === 'i') {
        writeToShell(id, promptTemplateRef.current);
        return false;
      }
      return true;
    });

    term.onData((data) => {
      if (onInput) {
        onInput(data);
      } else {
        writeToShell(id, data);
      }
    });

    const setupSession = async () => {
      // Agent mode — replay + live output from the store (single source,
      // synchronous attach: no gap or duplication against the backfill)
      if (agentId) {
        // Custom fonts change char metrics and therefore cols. Attach only
        // after they settle, or the later re-fit reflows the replayed TUI
        // screen into duplicated fragments.
        try {
          await document.fonts?.ready;
        } catch {}
        if (!isMounted) return;
        try {
          fitAddon.fit();
        } catch {}
        const detach = attachAgentStream({ write: writeTerm }, agentId);
        setIsInitialized(true);
        return detach;
      }

      if (id === 'main-terminal' && !cwd) {
        term.write('\r\n\x1b[33mAwaiting project directory...\x1b[0m\r\n');
        return;
      }

      try {
        await spawnShell(id, initialCommand || 'bash', [], cwd, term.rows, term.cols);
        setIsInitialized(true);

        const unsubOut = await onTerminalOut(id, (data) => writeTerm(data));
        const unsubErr = await onTerminalErr(id, (data) => writeTerm(data));

        return () => {
          unsubOut();
          unsubErr();
        };
      } catch (err) {
        term.write(`\r\n\x1b[31mFailed to connect to terminal: ${err}\x1b[0m\r\n`);
      }
    };

    let sessionCleanup: (() => void) | undefined;
    let isMounted = true;

    // Wait for the first browser paint so the container has its final CSS dimensions,
    // then fit the terminal and spawn the shell with the correct cols/rows.
    requestAnimationFrame(() => {
      if (!isMounted) return;
      try {
        fitAddon.fit();
      } catch {}

      setupSession().then((c) => {
        if (!isMounted) {
          c?.();
        } else {
          sessionCleanup = c;
        }
      });

      // Re-fit when custom fonts finish loading.
      // fitAddon.fit() measures char width from the DOM; if JetBrains Mono hasn't
      // loaded yet the fallback font metrics produce a wrong cols count. Calling
      // fit() again after fonts are ready corrects the PTY size via resizeShell.
      document.fonts.ready
        .then(() => {
          if (isMounted) fitAddonRef.current?.fit();
        })
        .catch(() => {});
    });

    return () => {
      isMounted = false;
      sessionCleanup?.();
      keepAlive.stop();
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      xtermUnmounted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd, initialCommand, agentId]);

  return (
    <div className="h-full w-full relative">
      {!isInitialized && id === 'main-terminal' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 text-[10px] text-foreground-muted animate-pulse uppercase tracking-widest pointer-events-none">
          Connecting to PTY...
        </div>
      )}
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { spawnShell, writeToShell, onTerminalOut, onTerminalErr } from '@/lib/tauri/terminal';
import { getPromptTemplate, FALLBACK_PROMPT_TEMPLATE } from '@/lib/tauri/providers';
import { xtermMounted, xtermUnmounted } from '@/lib/metrics';
import { attachImagePaste, attachFileDrop } from '@/lib/terminal/imageInsert';
import { createRenderKeepAlive } from '@/lib/terminal/renderKeepAlive';
import { TERMINAL_FONT_FAMILY, TERMINAL_SCROLLBACK, terminalTheme } from '@/lib/terminal/theme';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuOption } from '../../../lib/ui/contextMenu';
import {
  TERMINAL_INTERACTION_OPTIONS,
  buildTerminalMenu,
  copyText,
  handleTerminalClipboardKey,
  terminalMenuActions,
} from '@/lib/terminal/interactions';
import { readClipboardText } from '@/lib/tauri/clipboard';
import { forwardResizeToPty, observeFit, safeFit } from '@/lib/terminal/fit';

/** A shell terminal. Agent terminals are AgentXterm, which streams from the store. */
interface XtermTerminalProps {
  id: string; // Shell session id
  cwd?: string; // Working directory
  initialCommand?: string; // e.g. /bin/zsh
  /**
   * The project's own shell: it waits for a project folder before it starts
   * and shows that it is connecting meanwhile.
   */
  projectShell?: boolean;
}

export function XtermTerminal({ id, cwd, initialCommand, projectShell }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const promptTemplateRef = useRef<string>(FALLBACK_PROMPT_TEMPLATE);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    options: ContextMenuOption[];
  } | null>(null);

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
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: TERMINAL_SCROLLBACK,
      theme: terminalTheme('#00000000'), // Inherit from parent container
      allowTransparency: true,
      ...TERMINAL_INTERACTION_OPTIONS,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    xtermMounted();

    // Flush xterm's rAF-driven render even when WKWebView parks the compositor
    // between interactions (otherwise new output only paints on the next input).
    // Not for a terminal nobody can see: a background tab or a hidden window.
    const container = containerRef.current;
    const keepAlive = createRenderKeepAlive(
      undefined,
      undefined,
      undefined,
      undefined,
      () => document.visibilityState !== 'hidden' && isRendered(container)
    );
    const writeTerm = (data: string) => {
      term.write(data);
      keepAlive.nudge();
    };

    forwardResizeToPty(term, id);
    const stopFitting = observeFit(containerRef.current, fitAddon);

    // Intercept CMD+I to insert provider prompt template.
    // Flags go before -p so the cursor lands right after the opening quote —
    // no escape-sequence cursor movement needed, which avoids readline redraw bugs.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown' && event.metaKey && event.key === 'i') {
        writeToShell(id, promptTemplateRef.current);
        return false;
      }
      return handleTerminalClipboardKey(event, term);
    });

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const selection = term.getSelection();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        options: terminalMenuActions(buildTerminalMenu(selection, false), {
          copy: () => {
            void copyText(selection);
          },
          paste: () => {
            void readClipboardText().then((text) => {
              if (text) term.paste(text);
            });
          },
          selectAll: () => term.selectAll(),
        }),
      });
    };
    const host = containerRef.current;
    host.addEventListener('contextmenu', handleContextMenu);

    const sendText = (data: string) => {
      writeToShell(id, data);
    };

    term.onData(sendText);

    // Warp-style image handling: pasting an image saves it to the app cache
    // and inserts its path; dropping files inserts their paths.
    const detachImagePaste = attachImagePaste(containerRef.current, sendText);
    // Dropping onto a terminal is asking to talk to it: focus follows the
    // inserted path, so the next keystroke — usually Enter — lands here.
    const detachFileDrop = attachFileDrop(containerRef.current, sendText, setIsDropTarget, () =>
      term.focus()
    );

    const setupSession = async () => {
      if (projectShell && !cwd) {
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
      safeFit(fitAddon);

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
      detachImagePaste();
      detachFileDrop();
      keepAlive.stop();
      stopFitting();
      host.removeEventListener('contextmenu', handleContextMenu);
      term.dispose();
      termRef.current = null;
      xtermUnmounted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd, initialCommand]);

  return (
    <div className="h-full w-full relative">
      {!isInitialized && projectShell && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 text-[10px] text-foreground-muted animate-pulse uppercase tracking-widest pointer-events-none">
          Connecting to PTY...
        </div>
      )}
      <div ref={containerRef} data-testid="xterm" className="h-full w-full overflow-hidden" />
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
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={contextMenu.options}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * False for an element hidden by `display`/`visibility` somewhere up its tree.
 * Without `checkVisibility` (older engines) the answer is true, which only
 * keeps the old always-pump behaviour.
 */
function isRendered(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
    : true;
}

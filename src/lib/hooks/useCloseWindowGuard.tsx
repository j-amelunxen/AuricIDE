'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { runningAgentCount, quitWhileAgentsRunningRequest } from '@/lib/agents/closeGuard';
import { useConfirm } from './useConfirm';

/**
 * Intercepts every close that asks the window — traffic lights, Close Window,
 * Cmd+W with no tab — and asks first when an agent is still running. Cancel
 * aborts the close; confirming lets Tauri destroy the window as it would have.
 *
 * The native `window.confirm` cannot gate this (it does not suspend JS in the
 * webview), so the question is the same ConfirmDialog every other destructive
 * act uses. Tauri waits for the close-requested handler to settle, which is
 * what keeps the window up until the user answers.
 */
export function CloseWindowGuard() {
  const { confirm, confirmDialog } = useConfirm();
  const askingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const stop = await getCurrentWindow().onCloseRequested(async (event) => {
          const count = runningAgentCount(useStore.getState().agents);
          if (count === 0) return;
          // A second close while the question is open must not replace it —
          // that would settle the first as cancelled and leave the window
          // closing under a brand-new dialog.
          if (askingRef.current) {
            event.preventDefault();
            return;
          }
          askingRef.current = true;
          try {
            const go = await confirm(quitWhileAgentsRunningRequest(count));
            if (!go) event.preventDefault();
          } finally {
            askingRef.current = false;
          }
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // Browser mode — no window to close.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [confirm]);

  return confirmDialog;
}

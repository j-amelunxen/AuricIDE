import { useEffect } from 'react';
import { useStore } from '@/lib/store';

/**
 * Cmd/Ctrl+W closes the active editor tab — like Safari or Xcode — instead of
 * the whole window. With no tab open it falls through to closing the window.
 *
 * Two entry points feed the same action:
 *  - a keydown listener (Windows/Linux, where no native menu owns Ctrl+W)
 *  - the 'menu:close-tab' event emitted by the macOS app menu, where the
 *    native "Close Tab ⌘W" item consumes the shortcut before the webview
 *    ever sees the key event.
 *
 * Cmd+Shift+W stays untouched — that is the native Close Window path.
 */
export function useCloseTabShortcut() {
  useEffect(() => {
    const closeActiveTabOrWindow = async () => {
      const { activeTabId, closeTab } = useStore.getState();
      if (activeTabId) {
        closeTab(activeTabId);
        return;
      }
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } catch {
        // Browser mode — no window to close.
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        void closeActiveTabOrWindow();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen('menu:close-tab', () => void closeActiveTabOrWindow());
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      } catch {
        // Browser mode — no Tauri event system.
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      unlisten?.();
    };
  }, []);
}

import { useEffect, useRef } from 'react';

/**
 * Bridges the native macOS menu to the command palette's dispatch.
 *
 * The Rust side emits `menu:command` with a command id (see
 * `src-tauri/src/menu.rs`). Running it through the same `handleCommandExecute`
 * the palette uses is the point: one code path, one set of side effects, and
 * usage bookkeeping that does not depend on how the command was invoked.
 *
 * It also reports whether a project is open, so the menu can grey out the
 * commands that would otherwise quietly do nothing.
 */
export function useMenuCommands(onCommand: (commandId: string) => void, rootPath: string | null) {
  // The handler is rebuilt on nearly every render. Subscribing to it directly
  // would either resubscribe constantly or freeze the first closure — a menu
  // item that acts on state the user has since left behind.
  const handler = useRef(onCommand);
  handler.current = onCommand;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<string>('menu:command', (event) => {
          if (typeof event.payload === 'string') handler.current(event.payload);
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        // Browser mode — no native menu to listen to.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_menu_command_states', { projectOpen: rootPath !== null });
      } catch {
        // Browser mode — no native menu to update.
      }
    })();
  }, [rootPath]);
}

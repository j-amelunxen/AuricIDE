import { onMenuCommand, setMenuCommandStates } from '@/lib/tauri/appMenu';
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
  // Written after paint rather than during render: a menu command always
  // arrives from an event, long after effects for that render have run, so
  // the ref is current by the time it is read.
  useEffect(() => {
    handler.current = onCommand;
  });

  useEffect(() => onMenuCommand((command) => handler.current(command)), []);

  useEffect(() => {
    // Browser mode has no native menu to update.
    setMenuCommandStates(rootPath !== null).catch(() => {});
  }, [rootPath]);
}

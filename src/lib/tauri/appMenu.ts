import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

export const MENU_COMMAND_EVENT = 'menu:command';
export const MENU_CLOSE_TAB_EVENT = 'menu:close-tab';

/** A command picked in the native application menu (its id); returns the unsubscribe. */
export function onMenuCommand(onCommand: (command: string) => void): () => void {
  return subscribeToTauriEvent<unknown>(
    MENU_COMMAND_EVENT,
    (command) => {
      if (typeof command === 'string') onCommand(command);
    },
    'Application menu unavailable (browser mode)'
  );
}

/** The menu's Close Tab item (and its shortcut, which the menu owns natively). */
export function onMenuCloseTab(onClose: () => void): () => void {
  return subscribeToTauriEvent<unknown>(
    MENU_CLOSE_TAB_EVENT,
    () => onClose(),
    'Application menu unavailable (browser mode)'
  );
}

/** Enables the menu items that need an open project. */
export async function setMenuCommandStates(projectOpen: boolean): Promise<void> {
  await invoke('set_menu_command_states', { projectOpen });
}

import { invoke } from './invoke';

/** Emitted to the main window when a menu bar item or a global shortcut asks for a supervisor. */
export const MENU_BAR_LAUNCH_EVENT = 'menu-bar-launch';

export interface MenuBarSkill {
  /** The skill's id in the supervisor presets, or `auric:<id>` for an unpinned library skill. */
  id: string;
  label: string;
  /** An accelerator such as `Control+Alt+KeyV`. */
  shortcut?: string;
}

export interface MenuBarConfig {
  tray: boolean;
  shortcuts: boolean;
  /** Decides whether the menu offers "Start Supervisor" or "Open Supervisor". */
  running: boolean;
  skills: MenuBarSkill[];
}

/** `skillId` is absent for "Start/Open Supervisor". */
export interface MenuBarLaunchRequest {
  skillId?: string;
}

export interface ShortcutFailure {
  skillId: string;
  shortcut: string;
  reason: string;
}

/** Rebuilds the menu bar icon and re-registers the shortcuts; returns the ones macOS refused. */
export async function menuBarSync(config: MenuBarConfig): Promise<ShortcutFailure[]> {
  return await invoke<ShortcutFailure[]>('menu_bar_sync', { config });
}

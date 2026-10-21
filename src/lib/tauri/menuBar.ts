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
  /** How many supervisors run; above zero the menu also offers "Open Supervisor (N)". */
  running: number;
  skills: MenuBarSkill[];
}

/**
 * A skill pick carries `skillId` and always starts a new supervisor.
 * "Start Supervisor" carries `newSupervisor: true`; "Open Supervisor (N)"
 * carries neither and brings the newest running one forward.
 */
export interface MenuBarLaunchRequest {
  skillId?: string;
  newSupervisor?: boolean;
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

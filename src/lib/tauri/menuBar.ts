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

export interface MenuBarManager {
  key: string;
  label: string;
  /** A supervisor is working in its folder: the menu puts a dot before the name. */
  running: boolean;
  shortcut?: string;
}

export interface MenuBarConfig {
  tray: boolean;
  shortcuts: boolean;
  /** How many supervisors run; above zero the menu also offers "Open Supervisor (N)". */
  running: number;
  skills: MenuBarSkill[];
  /** The Project Managers set to show in the menu bar, non-archived, in the order listed. */
  managers: MenuBarManager[];
}

/**
 * A skill pick carries `skillId` and always starts a new supervisor.
 * "Start Supervisor" carries `newSupervisor: true`; "Open Supervisor (N)"
 * carries neither and brings the newest running one forward.
 */
export interface MenuBarLaunchRequest {
  skillId?: string;
  /** A Project Manager pick: opens that manager, a running one is focused. */
  managerKey?: string;
  newSupervisor?: boolean;
}

/** Names the skill or the manager the refused shortcut belongs to, never both. */
export interface ShortcutFailure {
  skillId?: string;
  managerKey?: string;
  shortcut: string;
  reason: string;
}

/** Rebuilds the menu bar icon and re-registers the shortcuts; returns the ones macOS refused. */
export async function menuBarSync(config: MenuBarConfig): Promise<ShortcutFailure[]> {
  return await invoke<ShortcutFailure[]>('menu_bar_sync', { config });
}

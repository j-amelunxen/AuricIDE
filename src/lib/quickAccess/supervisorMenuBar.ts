import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { resolveAuricSkillReference, type AuricSkillDefinition } from '@/lib/settings/auricSkills';
import type { MenuBarConfig } from '@/lib/tauri/menuBar';
import { menuSkillEntries } from './menuSkills';
import type { SupervisorPresets } from './supervisorPresets';

export interface MenuBarPrefs {
  /** The supervisor's icon in the macOS menu bar. */
  tray: boolean;
  /** The skills' shortcuts, answered while another app is in front. */
  shortcuts: boolean;
}

/** Both off until switched on in Settings → Supervisor: a menu bar icon nobody asked for is clutter. */
export function readMenuBarPrefs(): MenuBarPrefs {
  return {
    tray: readAppPref(APP_CONFIG_KEYS.supervisorMenuBar) === 'true',
    shortcuts: readAppPref(APP_CONFIG_KEYS.supervisorGlobalShortcuts) === 'true',
  };
}

export function writeMenuBarPrefs(prefs: MenuBarPrefs): void {
  writeAppPref(APP_CONFIG_KEYS.supervisorMenuBar, String(prefs.tray));
  writeAppPref(APP_CONFIG_KEYS.supervisorGlobalShortcuts, String(prefs.shortcuts));
}

/**
 * What the menu bar shows: the same skills as the tile's right-click menu,
 * pinned ones first with their shortcut, then the Settings → Skills library.
 * Rust builds the menu and registers the shortcuts from exactly this.
 */
export function menuBarConfig(
  presets: SupervisorPresets,
  library: AuricSkillDefinition[],
  prefs: MenuBarPrefs,
  running: boolean
): MenuBarConfig {
  const skills = menuSkillEntries(presets.skills, library).map((entry) => {
    const { label } = resolveAuricSkillReference(entry, library);
    return entry.shortcut
      ? { id: entry.id, label, shortcut: entry.shortcut }
      : { id: entry.id, label };
  });
  return { tray: prefs.tray, shortcuts: prefs.shortcuts, running, skills };
}

interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_CODES = /^(Meta|Control|Alt|Shift|OS)(Left|Right)?$/;
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/**
 * A pressed combination as an accelerator the global-shortcut plugin parses.
 * Read from `code`, not `key`: with Option held, macOS turns V into √.
 * A shortcut that works in every app needs Control, Option or Command — a
 * bare letter or Shift+letter would swallow ordinary typing. Function keys
 * are the one exception.
 */
export function acceleratorFromKeyEvent(event: KeyLike): string | null {
  if (MODIFIER_CODES.test(event.code)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  const strong = event.ctrlKey || event.altKey || event.metaKey;
  if (!strong && !FUNCTION_KEY.test(event.code)) return null;
  return [...parts, event.code].join('+');
}

const SYMBOLS: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' };
const ORDER = ['Control', 'Alt', 'Shift', 'Super'];

/** "Control+Alt+KeyV" as a macOS menu writes it: ⌃⌥V. */
export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1] ?? '';
  const mods = ORDER.filter((mod) => parts.includes(mod))
    .map((mod) => SYMBOLS[mod])
    .join('');
  return mods + key.replace(/^Key|^Digit/, '');
}

/** Shortcuts that more than one skill claims; only the first could be registered. */
export function duplicateShortcuts(skills: { shortcut?: string }[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { shortcut } of skills) {
    if (!shortcut) continue;
    if (seen.has(shortcut)) twice.add(shortcut);
    seen.add(shortcut);
  }
  return twice;
}

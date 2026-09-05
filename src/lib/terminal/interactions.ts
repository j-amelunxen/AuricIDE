/**
 * Shared copy / paste / select-all + xterm interaction options.
 *
 * Claude Code (and other TUIs) enable mouse tracking, which makes xterm send
 * clicks to the PTY instead of selecting. `macOptionClickForcesSelection`
 * plus Shift-drag (built into xterm) recover selection. Clipboard shortcuts
 * and the right-click menu live here so both terminal surfaces stay in sync.
 *
 * WKWebView reports mouse-wheel as small pixel deltas; xterm then divides by
 * 40, so the default `scrollSensitivity: 1` crawls. We bump it and keep
 * smooth-scroll off so a notch jumps instead of easing.
 */
import { copyToClipboard, readClipboardText as readClipboard } from '@/lib/tauri/clipboard';

export const TERMINAL_INTERACTION_OPTIONS = {
  macOptionClickForcesSelection: true,
  rightClickSelectsWord: false,
  scrollSensitivity: 3,
  fastScrollSensitivity: 5,
  smoothScrollDuration: 0,
} as const;

export type ClipboardKeyAction = 'copy' | 'select-all' | 'pass';

export interface ClipboardKeyEvent {
  type: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function clipboardKeyAction(
  event: ClipboardKeyEvent,
  hasSelection: boolean
): ClipboardKeyAction {
  if (event.type !== 'keydown') return 'pass';
  // Cmd only — Ctrl+C must still reach the PTY as SIGINT.
  if (!event.metaKey || event.ctrlKey || event.altKey) return 'pass';
  const key = event.key.toLowerCase();
  if (key === 'c' && hasSelection) return 'copy';
  if (key === 'a') return 'select-all';
  return 'pass';
}

export interface TerminalClipboardHost {
  hasSelection: () => boolean;
  getSelection: () => string;
  selectAll: () => void;
}

/** Returns false when the key was consumed (xterm must not also handle it). */
export function handleTerminalClipboardKey(
  event: ClipboardKeyEvent,
  term: TerminalClipboardHost
): boolean {
  const action = clipboardKeyAction(event, term.hasSelection());
  if (action === 'copy') {
    void copyText(term.getSelection());
    return false;
  }
  if (action === 'select-all') {
    term.selectAll();
    return false;
  }
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  return await copyToClipboard(text);
}

export async function readClipboardText(): Promise<string> {
  return await readClipboard();
}

export type TerminalMenuKind = 'copy' | 'paste' | 'select-all' | 'spawn' | 'separator';

export interface TerminalMenuEntry {
  kind: TerminalMenuKind;
  label?: string;
  icon?: string;
}

export function buildTerminalMenu(selection: string, canSpawn: boolean): TerminalMenuEntry[] {
  const items: TerminalMenuEntry[] = [];
  if (selection) {
    items.push({ kind: 'copy', label: 'Copy', icon: 'content_copy' });
  }
  items.push({ kind: 'paste', label: 'Paste', icon: 'content_paste' });
  items.push({ kind: 'select-all', label: 'Select All', icon: 'checklist' });
  if (selection && canSpawn) {
    items.push({ kind: 'separator' });
    items.push({ kind: 'spawn', label: 'Spawn Agent with Selection', icon: 'bolt' });
  }
  return items;
}

export type TerminalMenuOption =
  { type: 'separator' } | { type?: 'item'; label: string; icon?: string; action?: () => void };

export function terminalMenuActions(
  entries: TerminalMenuEntry[],
  handlers: {
    copy: () => void;
    paste: () => void;
    selectAll: () => void;
    spawn?: () => void;
  }
): TerminalMenuOption[] {
  const options: TerminalMenuOption[] = [];
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      options.push({ type: 'separator' });
      continue;
    }
    const action =
      entry.kind === 'copy'
        ? handlers.copy
        : entry.kind === 'paste'
          ? handlers.paste
          : entry.kind === 'select-all'
            ? handlers.selectAll
            : handlers.spawn;
    options.push({
      label: entry.label ?? '',
      icon: entry.icon,
      action,
    });
  }
  return options;
}

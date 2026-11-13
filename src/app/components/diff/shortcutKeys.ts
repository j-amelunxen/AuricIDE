/**
 * Keys are written as the glyphs people see on a Mac keyboard (`['⌥', '↓']`).
 * These helpers turn the same array into the two other forms a shortcut
 * needs: words a screen reader can say, and the `aria-keyshortcuts` value.
 */

const SPOKEN: Record<string, string> = {
  '⌘': 'Command',
  '⌥': 'Option',
  '⇧': 'Shift',
  '⌃': 'Control',
  '↑': 'Up arrow',
  '↓': 'Down arrow',
  '←': 'Left arrow',
  '→': 'Right arrow',
  '↵': 'Return',
  '⌫': 'Delete',
  esc: 'Escape',
};

const ARIA: Record<string, string> = {
  '⌘': 'Meta',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '⌃': 'Control',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↵': 'Enter',
  '⌫': 'Backspace',
  esc: 'Escape',
};

/** "Option Down arrow". */
export function spokenKeys(keys: readonly string[]): string {
  return keys.map((k) => SPOKEN[k] ?? k.toUpperCase()).join(' ');
}

/** "Alt+ArrowDown", the format `aria-keyshortcuts` expects. */
export function ariaKeyshortcuts(keys: readonly string[]): string {
  return keys.map((k) => ARIA[k] ?? k.toUpperCase()).join('+');
}

/** `?` opens the sheet, unless the reader is typing. */
export function isShortcutSheetKey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  return !(
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target.isContentEditable
  );
}

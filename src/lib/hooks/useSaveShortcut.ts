import { useEffect } from 'react';

/**
 * ⌘S / Ctrl+S saves a planning surface (tickets, requirements, goals) while
 * it is the active one. The browser's own "save page" is always held back
 * there; the save runs only when something is unsaved.
 */
export function useSaveShortcut(
  active: boolean,
  dirty: boolean,
  save: () => Promise<unknown>
): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, dirty, save]);
}

'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_ACCENT_ID, isAccentId, loadAccent, saveAccent } from './accent';
import { THEME_CHANGE_EVENT } from './catalog/controller';

const ACCENT_CHANGE_EVENT = 'auric-accent-change';

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(ACCENT_CHANGE_EVENT, callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(ACCENT_CHANGE_EVENT, callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

/**
 * Subscribes to the persisted accent (external store: localStorage + a custom
 * event for same-tab updates). Returns the current accent and a setter that
 * persists, applies, and notifies subscribers. SSR renders the default.
 */
export function useAccent(): [string, (id: string) => void] {
  const accent = useSyncExternalStore(subscribe, loadAccent, () => DEFAULT_ACCENT_ID);

  const select = useCallback((id: string) => {
    if (!isAccentId(id)) return;
    saveAccent(id);
    window.dispatchEvent(new Event(ACCENT_CHANGE_EVENT));
  }, []);

  return [accent, select];
}

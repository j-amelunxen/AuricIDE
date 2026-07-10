'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const ATTRIBUTION_STORAGE_KEY = 'auric-show-attribution';

const ATTRIBUTION_CHANGE_EVENT = 'auric-attribution-change';

/** Default is OFF — the credit is opt-in advertising, never forced. */
export function loadShowAttribution(): boolean {
  try {
    return localStorage.getItem(ATTRIBUTION_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveShowAttribution(value: boolean): void {
  try {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, String(value));
  } catch {
    // Persistence is best-effort; still notify for the current session.
  }
  window.dispatchEvent(new Event(ATTRIBUTION_CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(ATTRIBUTION_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(ATTRIBUTION_CHANGE_EVENT, callback);
  };
}

/**
 * Subscribes to the persisted attribution flag (localStorage + a custom event
 * for same-tab updates, same pattern as useAccent). SSR renders the default.
 */
export function useAttribution(): [boolean, (value: boolean) => void] {
  const show = useSyncExternalStore(subscribe, loadShowAttribution, () => false);
  const setShow = useCallback((value: boolean) => saveShowAttribution(value), []);
  return [show, setShow];
}

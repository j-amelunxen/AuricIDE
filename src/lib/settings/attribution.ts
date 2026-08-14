'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';

/** Application-wide: the credit belongs to the install, not to a project. */
export const ATTRIBUTION_STORAGE_KEY = APP_CONFIG_KEYS.showAttribution;

const ATTRIBUTION_CHANGE_EVENT = 'auric-attribution-change';

/** Default is OFF — the credit is opt-in advertising, never forced. */
export function loadShowAttribution(): boolean {
  return readAppPref(ATTRIBUTION_STORAGE_KEY) === 'true';
}

export function saveShowAttribution(value: boolean): void {
  // Persistence is best-effort; notify either way so the session still updates.
  writeAppPref(ATTRIBUTION_STORAGE_KEY, String(value));
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

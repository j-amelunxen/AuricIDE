'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';

/** Application-wide: the clock belongs to the install, not to a project. */
export const STATUS_BAR_CLOCK_STORAGE_KEY = APP_CONFIG_KEYS.statusBarClock;

const STATUS_BAR_CLOCK_CHANGE_EVENT = 'auric-status-bar-clock-change';

/** Default is ON — the clock is a utility, not something you have to ask for. */
export function loadShowStatusBarClock(): boolean {
  return readAppPref(STATUS_BAR_CLOCK_STORAGE_KEY) !== 'false';
}

export function saveShowStatusBarClock(value: boolean): void {
  // Persistence is best-effort; notify either way so the session still updates.
  writeAppPref(STATUS_BAR_CLOCK_STORAGE_KEY, String(value));
  window.dispatchEvent(new Event(STATUS_BAR_CLOCK_CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(STATUS_BAR_CLOCK_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(STATUS_BAR_CLOCK_CHANGE_EVENT, callback);
  };
}

/**
 * Subscribes to the persisted clock flag (localStorage + a custom event for
 * same-tab updates). SSR renders the default.
 */
export function useStatusBarClock(): [boolean, (value: boolean) => void] {
  const show = useSyncExternalStore(subscribe, loadShowStatusBarClock, () => true);
  const setShow = useCallback((value: boolean) => saveShowStatusBarClock(value), []);
  return [show, setShow];
}

'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  APP_CONFIG_KEYS,
  readAppPref,
  subscribeAppPrefs,
  writeAppPref,
} from '@/lib/config/appConfig';

/** Application-wide: the clock belongs to the install, not to a project. */
export const STATUS_BAR_CLOCK_STORAGE_KEY = APP_CONFIG_KEYS.statusBarClock;

/** Default is ON — the clock is a utility, not something you have to ask for. */
export function loadShowStatusBarClock(): boolean {
  return readAppPref(STATUS_BAR_CLOCK_STORAGE_KEY) !== 'false';
}

export function saveShowStatusBarClock(value: boolean): void {
  writeAppPref(STATUS_BAR_CLOCK_STORAGE_KEY, String(value));
}

function subscribe(callback: () => void): () => void {
  return subscribeAppPrefs([STATUS_BAR_CLOCK_STORAGE_KEY], callback);
}

/** Subscribes to the persisted clock flag. SSR renders the default. */
export function useStatusBarClock(): [boolean, (value: boolean) => void] {
  const show = useSyncExternalStore(subscribe, loadShowStatusBarClock, () => true);
  const setShow = useCallback((value: boolean) => saveShowStatusBarClock(value), []);
  return [show, setShow];
}

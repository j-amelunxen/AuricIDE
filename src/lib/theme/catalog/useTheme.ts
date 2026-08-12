'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ThemeMeta } from './types';
import {
  getRegistrySkipped,
  getThemeList,
  getThemeSnapshot,
  getSelectedThemeId,
  hydrateThemes,
  THEME_CHANGE_EVENT,
  selectTheme,
} from './controller';
import { DEFAULT_THEME_ID } from './builtins';

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getSnapshot(): string {
  return getThemeSnapshot();
}

function getServerSnapshot(): string {
  return `${DEFAULT_THEME_ID}|0|0`;
}

export interface UseThemeResult {
  id: string;
  list: ThemeMeta[];
  skippedCount: number;
  select: (id: string) => void;
  reload: () => Promise<void>;
}

/**
 * Subscribe to the active Theme. Hydrates custom themes from disk once on mount.
 */
export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const id = snapshot.split('|')[0] || getSelectedThemeId();

  useEffect(() => {
    void hydrateThemes();
  }, []);

  // Re-read list when snapshot changes (hydrate / select / reload).
  void snapshot;
  const list = getThemeList();
  const skippedCount = getRegistrySkipped().length;

  const select = useCallback((nextId: string) => {
    selectTheme(nextId);
  }, []);

  const reload = useCallback(async () => {
    await hydrateThemes();
  }, []);

  return { id, list, skippedCount, select, reload };
}

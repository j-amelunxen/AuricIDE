'use client';

import { useEffect, useState } from 'react';
import { APP_CONFIG_CHANGED_EVENT, APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { loadSupervisorPresets, type SupervisorPresets } from './supervisorPresets';

/**
 * The supervisor tile's presets, kept current: the tile, its wheel and the
 * settings dialog each read them, and a save in the dialog has to reach the
 * wheel without a remount.
 */
export function useSupervisorPresets(): SupervisorPresets {
  const [presets, setPresets] = useState(loadSupervisorPresets);
  useEffect(() => {
    const onChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === APP_CONFIG_KEYS.supervisorQuickAccess) setPresets(loadSupervisorPresets());
    };
    window.addEventListener(APP_CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(APP_CONFIG_CHANGED_EVENT, onChange);
  }, []);
  return presets;
}

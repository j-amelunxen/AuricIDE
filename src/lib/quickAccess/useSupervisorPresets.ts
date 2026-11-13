'use client';

import { useEffect, useState } from 'react';
import { APP_CONFIG_KEYS, subscribeAppPrefs } from '@/lib/config/appConfig';
import { loadSupervisorPresets, type SupervisorPresets } from './supervisorPresets';

/**
 * The supervisor tile's presets, kept current: the tile, its wheel and the
 * settings dialog each read them, and a save in the dialog has to reach the
 * wheel without a remount.
 */
export function useSupervisorPresets(): SupervisorPresets {
  const [presets, setPresets] = useState(loadSupervisorPresets);
  useEffect(
    () =>
      subscribeAppPrefs([APP_CONFIG_KEYS.supervisorQuickAccess], () =>
        setPresets(loadSupervisorPresets())
      ),
    []
  );
  return presets;
}

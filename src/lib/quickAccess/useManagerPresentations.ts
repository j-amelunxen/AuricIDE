'use client';

import { useEffect, useState } from 'react';
import { APP_CONFIG_KEYS, subscribeAppPrefs } from '@/lib/config/appConfig';
import { readManagerPresentations, type ManagerPresentations } from './managerPresentation';

/** The managers' presentation, kept current: Quick Access and Settings both read and write it. */
export function useManagerPresentations(): ManagerPresentations {
  const [presentations, setPresentations] = useState(readManagerPresentations);
  useEffect(
    () =>
      subscribeAppPrefs([APP_CONFIG_KEYS.supervisorManagers], () =>
        setPresentations(readManagerPresentations())
      ),
    []
  );
  return presentations;
}

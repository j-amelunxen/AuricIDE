'use client';

import { useEffect, useState } from 'react';
import { APP_CONFIG_CHANGED_EVENT, APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { readManagerPresentations, type ManagerPresentations } from './managerPresentation';

/** The managers' presentation, kept current: Quick Access and Settings both read and write it. */
export function useManagerPresentations(): ManagerPresentations {
  const [presentations, setPresentations] = useState(readManagerPresentations);
  useEffect(() => {
    const onChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key === APP_CONFIG_KEYS.supervisorManagers) setPresentations(readManagerPresentations());
    };
    window.addEventListener(APP_CONFIG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(APP_CONFIG_CHANGED_EVENT, onChange);
  }, []);
  return presentations;
}

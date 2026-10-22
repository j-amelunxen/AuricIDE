'use client';

import { useEffect, useState } from 'react';
import {
  MANAGERS_CHANGED_EVENT,
  managerRegistry,
  type ManagerRegistry,
} from '@/lib/tauri/supervisorManagers';

const NO_MANAGERS: ManagerRegistry = { managers: [], error: null };

/**
 * The Project Manager registry, kept current for surfaces that list managers:
 * read on mount, after every change made through the IPC wrappers, and when
 * the window comes back into focus. Without IPC (browser mode) it is empty.
 */
export function useProjectManagers(): ManagerRegistry {
  const [registry, setRegistry] = useState(NO_MANAGERS);

  useEffect(() => {
    let alive = true;
    const read = () => {
      managerRegistry()
        .catch(() => NO_MANAGERS)
        .then((next) => alive && setRegistry(next));
    };
    read();
    window.addEventListener(MANAGERS_CHANGED_EVENT, read);
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      window.removeEventListener(MANAGERS_CHANGED_EVENT, read);
      window.removeEventListener('focus', read);
    };
  }, []);

  return registry;
}

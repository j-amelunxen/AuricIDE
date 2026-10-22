'use client';

import { useEffect, useState } from 'react';
import {
  MANAGERS_CHANGED_EVENT,
  managerRegistry,
  type ManagerRegistry,
} from '@/lib/tauri/supervisorManagers';

const NO_MANAGERS: ManagerRegistry = { managers: [], error: null };

const NO_IPC = /Tauri IPC is unavailable/;

/** The registry after a failed read: the last good list stays, the error is named (browser mode says nothing). */
function afterFailedRead(previous: ManagerRegistry, failure: unknown): ManagerRegistry {
  const message = failure instanceof Error ? failure.message : String(failure);
  if (NO_IPC.test(message)) return previous;
  return { managers: previous.managers, error: `The managers could not be read: ${message}` };
}

/** A re-read that found the same content keeps the old object, so nothing downstream re-syncs. */
const sameContent = (a: ManagerRegistry, b: ManagerRegistry) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The Project Manager registry, kept current for surfaces that list managers:
 * read on mount, after every change made through the IPC wrappers, and when
 * the window comes back into focus. Without IPC (browser mode) it is empty.
 * A read that fails keeps the last good list; a read that is overtaken by a
 * newer one is dropped.
 */
export function useProjectManagers(): ManagerRegistry {
  const [registry, setRegistry] = useState(NO_MANAGERS);

  useEffect(() => {
    let alive = true;
    let latestRead = 0;
    const settle = (read: number, next: (previous: ManagerRegistry) => ManagerRegistry) => {
      if (!alive || read !== latestRead) return;
      setRegistry((previous) => {
        const updated = next(previous);
        return sameContent(previous, updated) ? previous : updated;
      });
    };
    const read = () => {
      latestRead += 1;
      const mine = latestRead;
      managerRegistry().then(
        (next) => settle(mine, () => next),
        (failure) => settle(mine, (previous) => afterFailedRead(previous, failure))
      );
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

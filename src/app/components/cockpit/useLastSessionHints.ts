'use client';

import { useCallback, useRef, useState } from 'react';
import { formatSessionAge } from '@/app/components/agents/sessionAge';
import { managerMemory } from '@/lib/tauri/supervisorManagers';

/** A session note changes when a session ends; a hint older than this is read again on the next hover. */
export const HINT_MAX_AGE_MS = 30_000;

/**
 * The tooltip line of each manager tile: the manager's own words about its
 * last session and how long ago. Read lazily, when the pointer or focus
 * reaches a tile, and at most once per `HINT_MAX_AGE_MS` per manager: a row of
 * tiles never costs one read per render.
 */
export function useLastSessionHints(): {
  hintFor: (managerKey: string) => string | undefined;
  request: (managerKey: string) => void;
} {
  const [hints, setHints] = useState<Record<string, string | null>>({});
  const askedAt = useRef(new Map<string, number>());

  const request = useCallback((managerKey: string) => {
    const now = Date.now();
    const last = askedAt.current.get(managerKey);
    if (last !== undefined && now - last < HINT_MAX_AGE_MS) return;
    askedAt.current.set(managerKey, now);
    // Wrapped so a synchronous throw from the wrapper is a failed read, not an unhandled error.
    Promise.resolve()
      .then(() => managerMemory(managerKey))
      .then(
        ({ lastSession }) =>
          setHints((current) => ({
            ...current,
            [managerKey]: lastSession
              ? `${lastSession.description} · ${formatSessionAge(Date.now() - lastSession.atMs)}`
              : null,
          })),
        // Not asked again for a while; the tooltip simply stays as it was.
        () => undefined
      );
  }, []);

  const hintFor = (managerKey: string) => hints[managerKey] ?? undefined;
  return { hintFor, request };
}

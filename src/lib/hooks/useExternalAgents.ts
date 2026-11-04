'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExternalAgent } from '@/lib/agents/externalAgents';
import {
  externalAgentClose,
  externalAgentsList,
  onExternalAgentsChanged,
} from '@/lib/tauri/externalAgents';

const NONE: ExternalAgent[] = [];

/**
 * The tracked external runs, as local state rather than a store slice: the
 * detached agent window has a store of its own with one writer per field, and
 * this list needs neither. Rust is the only source, so each window just reads it.
 *
 * Browser mode and an unreadable registry both read as an empty list, which is
 * what the contract asks of the timeline.
 */
export function useExternalAgents(): {
  externals: ExternalAgent[];
  closeExternal: (id: string) => Promise<void>;
} {
  const [externals, setExternals] = useState(NONE);
  const latestRead = useRef(0);

  const reload = useCallback(async () => {
    latestRead.current += 1;
    const read = latestRead.current;
    let next = NONE;
    try {
      const listed = await externalAgentsList();
      if (Array.isArray(listed) && listed.length > 0) next = listed;
    } catch {
      // See above: no rows is the answer here, and the next change event tries again.
    }
    // Two reads can cross; an older answer must not replace a newer one.
    if (read === latestRead.current) setExternals(next);
  }, []);

  useEffect(() => {
    void reload();
    // Read again once listening: a change between the first read and here has no event.
    const unsubscribe = onExternalAgentsChanged(
      () => void reload(),
      () => void reload()
    );
    const reads = latestRead;
    return () => {
      unsubscribe();
      reads.current += 1;
    };
  }, [reload]);

  const closeExternal = useCallback(
    async (id: string) => {
      await externalAgentClose(id);
      await reload();
    },
    [reload]
  );

  return { externals, closeExternal };
}

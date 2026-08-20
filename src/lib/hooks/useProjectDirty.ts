'use client';

import { useEffect, useState } from 'react';
import { loadProjectsDirty } from '@/lib/git/projectDirty';
import { useStore } from '@/lib/store';

function sameDirtyMap(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * Dirty flags for a list of project folders, keyed by path. Missing keys are
 * clean: a tile must not light up before the probe answers, or after it fails.
 *
 * Refreshes when the path list changes, when ignored nested repos change,
 * and when the window is shown again — coming back to the splash after a
 * commit should drop the dot.
 */
export function useProjectDirty(paths: readonly string[]): Record<string, boolean> {
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const key = paths.join('\0');
  const epoch = useStore((s) => s.projectDirtyEpoch);

  useEffect(() => {
    const asked = key.length === 0 ? [] : key.split('\0');
    let cancelled = false;

    const apply = (next: Record<string, boolean>) => {
      if (cancelled) return;
      // Identical maps keep the previous object so a clean probe does not
      // re-render every Quick Access test that never asked for a badge.
      setDirty((prev) => (sameDirtyMap(prev, next) ? prev : next));
    };

    if (asked.length === 0) {
      apply({});
      return () => {
        cancelled = true;
      };
    }

    const refresh = () => {
      void loadProjectsDirty(asked).then(apply);
    };

    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, epoch]);

  return dirty;
}

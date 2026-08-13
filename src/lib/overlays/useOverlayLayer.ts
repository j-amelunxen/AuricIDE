'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { OverlayKind } from './stack';

export function useOverlayLayer({
  id,
  kind,
  active,
  onEscape,
}: {
  id: string;
  kind: OverlayKind;
  active: boolean;
  onEscape?: () => void;
}): { ownsEscape: boolean } {
  const pushOverlay = useStore((s) => s.pushOverlay);
  const removeOverlay = useStore((s) => s.removeOverlay);
  const ownsEscape = useStore((s) => (active ? s.overlayStack.layers.at(-1)?.id === id : false));

  useEffect(() => {
    if (!active) {
      removeOverlay(id);
      return;
    }
    pushOverlay({ id, kind });
    return () => {
      removeOverlay(id);
    };
  }, [active, id, kind, pushOverlay, removeOverlay]);

  useEffect(() => {
    if (!active || !onEscape) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!useStore.getState().ownsEscape(id)) return;
      event.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, id, onEscape]);

  return { ownsEscape };
}

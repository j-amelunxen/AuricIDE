import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { zoneAt, type DropZone } from '@/lib/agents/terminalGrid';
import { pastDragThreshold, swallowNextClick } from '@/lib/ui/pointerDrag';

export interface TabGridDrag {
  agentId: string;
  /** Null while the pointer is outside the terminal area — a release there drops nothing. */
  zone: DropZone | null;
}

/**
 * Dragging a tab into the terminal area to split it. Plain mouse events rather
 * than HTML5 drag-and-drop: every terminal is already a file drop target, and
 * a native drag crossing one would light up its "drop to insert path" overlay.
 */
export function useTabGridDrag(
  areaRef: RefObject<HTMLElement | null>,
  onDrop: (agentId: string, zone: DropZone) => void
) {
  const [drag, setDrag] = useState<TabGridDrag | null>(null);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const begin = useCallback(
    (agentId: string, event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      stopRef.current?.();
      const origin = { x: event.clientX, y: event.clientY };
      let dragging = false;
      let zone: DropZone | null = null;

      const stop = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', release);
        window.removeEventListener('keydown', cancel, true);
        stopRef.current = null;
        setDrag(null);
      };
      const move = (e: globalThis.MouseEvent) => {
        if (!dragging) {
          if (!pastDragThreshold(origin, e)) return;
          dragging = true;
        }
        const rect = areaRef.current?.getBoundingClientRect();
        zone = rect ? zoneAt(e.clientX, e.clientY, rect) : null;
        setDrag({ agentId, zone });
      };
      const release = () => {
        stop();
        if (!dragging) return;
        swallowNextClick();
        if (zone) onDropRef.current(agentId, zone);
      };
      const cancel = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !dragging) return;
        // Escape belongs to the drag while one is under way, not to the dialog.
        e.stopPropagation();
        stop();
      };

      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', release);
      window.addEventListener('keydown', cancel, true);
      stopRef.current = stop;
    },
    [areaRef]
  );

  return { drag, begin };
}

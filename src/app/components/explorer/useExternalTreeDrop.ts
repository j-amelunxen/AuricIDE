import { useEffect, useRef, useState, type RefObject } from 'react';
import { dropTargetAt, elementAt } from './dropTarget';

/**
 * Files dragged in from Finder. Tauri takes native drops over the webview
 * (see `useTreeDrag`), so they arrive as webview drag-drop events with
 * absolute paths and a physical-pixel position, never as DOM `drop` events.
 * The position is hit-tested against the tree the same way a row drag is.
 *
 * In browser mode there is no such event source and the hook does nothing.
 */
export function useExternalTreeDrop({
  paneRef,
  rootPath,
  onDropPaths,
}: {
  paneRef: RefObject<HTMLElement | null>;
  rootPath: string | null | undefined;
  onDropPaths?: (paths: string[], destDir: string) => void;
}): string | null {
  const [target, setTarget] = useState<string | null>(null);
  const latest = useRef({ rootPath, onDropPaths });
  useEffect(() => {
    latest.current = { rootPath, onDropPaths };
  });
  const enabled = !!onDropPaths;

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    // `over` carries no paths; an `enter` without any (a drag that started
    // inside the page) is none of ours.
    let carriesPaths = false;

    const targetAt = (position: { x: number; y: number }) => {
      const scale = window.devicePixelRatio || 1;
      const hit = elementAt(position.x / scale, position.y / scale);
      return dropTargetAt(hit, paneRef.current, latest.current.rootPath)?.dir ?? null;
    };

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter') {
            carriesPaths = payload.paths.length > 0;
            setTarget(carriesPaths ? targetAt(payload.position) : null);
          } else if (payload.type === 'over') {
            setTarget(carriesPaths ? targetAt(payload.position) : null);
          } else if (payload.type === 'drop') {
            setTarget(null);
            const dir = payload.paths.length > 0 ? targetAt(payload.position) : null;
            if (dir) latest.current.onDropPaths?.(payload.paths, dir);
            carriesPaths = false;
          } else {
            setTarget(null);
            carriesPaths = false;
          }
        });
        if (disposed) un();
        else unlisten = un;
      } catch {
        // Browser mode: no native drag-drop events.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, paneRef]);

  return target;
}

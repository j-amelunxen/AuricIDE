import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { dragItems } from '@/lib/explorer/treeSelection';
import { canDropInto, dropTargetAt, elementAt } from './dropTarget';

/**
 * Moving explorer rows by dragging them onto a folder.
 *
 * Built on mouse events rather than HTML5 drag-and-drop on purpose. Tauri's
 * native drop handler (`dragDropEnabled`, on by default and needed for file
 * drops from Finder into terminals and the canvas) takes every drag session
 * over the webview on macOS: wry answers `draggingUpdated`/`performDragOperation`
 * itself and never hands them to WKWebView, so `dragover` and `drop` never
 * fire inside the page. An HTML5 drag started in the tree therefore could
 * never land anywhere in the real app. Mouse events are not intercepted.
 */

/** Pixels the pointer travels before a press becomes a drag (a click stays a click). */
export const DRAG_THRESHOLD_PX = 4;
/** How long a collapsed folder is hovered before it opens. */
export const AUTO_EXPAND_MS = 600;
/** Distance from the pane's top/bottom edge at which the pane scrolls by itself. */
const EDGE_SCROLL_ZONE_PX = 24;
const EDGE_SCROLL_STEP_PX = 12;
const EDGE_SCROLL_INTERVAL_MS = 30;

export interface TreeDragState {
  items: string[];
  /** Folder the items would land in, or null outside the pane. */
  target: string | null;
  valid: boolean;
}

interface Pending {
  path: string;
  x: number;
  y: number;
}

export interface UseTreeDragOptions {
  paneRef: RefObject<HTMLElement | null>;
  rootPath: string | null | undefined;
  selectedPaths: readonly string[];
  selectedPath: string | null;
  onMoveNodes?: (paths: string[], destDir: string) => void;
  /** Opens a collapsed folder without changing the selection. */
  onExpandDir?: (path: string) => void;
  isCollapsedDir: (path: string) => boolean;
}

// code-gate: complexity-function-length - one drag session; the listeners share its refs
export function useTreeDrag({
  paneRef,
  rootPath,
  selectedPaths,
  selectedPath,
  onMoveNodes,
  onExpandDir,
  isCollapsedDir,
}: UseTreeDragOptions) {
  const [drag, setDrag] = useState<TreeDragState | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  // A callback ref: the ghost mounts after the first move, and must not
  // flash at the top-left corner until the second one.
  const ghostRef = useCallback((node: HTMLDivElement | null) => {
    ghost.current = node;
    placeGhost(node, pointer.current.x, pointer.current.y);
  }, []);

  // The window listeners outlive any one render; they read the latest props here.
  const latest = useRef({
    rootPath,
    selectedPaths,
    selectedPath,
    onMoveNodes,
    onExpandDir,
    isCollapsedDir,
  });
  useEffect(() => {
    latest.current = {
      rootPath,
      selectedPaths,
      selectedPath,
      onMoveNodes,
      onExpandDir,
      isCollapsedDir,
    };
  });

  const pending = useRef<Pending | null>(null);
  const session = useRef<TreeDragState | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandFor = useRef<string | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const clearExpand = () => {
    if (expandTimer.current !== null) clearTimeout(expandTimer.current);
    expandTimer.current = null;
    expandFor.current = null;
  };
  const clearScroll = () => {
    if (scrollTimer.current !== null) clearInterval(scrollTimer.current);
    scrollTimer.current = null;
  };

  const end = useCallback(() => {
    detach.current?.();
    detach.current = null;
    pending.current = null;
    session.current = null;
    clearExpand();
    clearScroll();
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    setDrag(null);
  }, []);

  useEffect(() => end, [end]);

  const update = (next: TreeDragState) => {
    const prev = session.current;
    session.current = next;
    document.body.style.cursor = next.target !== null && !next.valid ? 'not-allowed' : 'grabbing';
    if (prev && prev.target === next.target && prev.valid === next.valid) return;
    setDrag(next);
  };

  const scheduleExpand = (hoveredDir: string | null) => {
    if (hoveredDir === expandFor.current) return;
    clearExpand();
    const { isCollapsedDir: collapsed, onExpandDir: expand } = latest.current;
    if (hoveredDir === null || !expand || !collapsed(hoveredDir)) return;
    expandFor.current = hoveredDir;
    expandTimer.current = setTimeout(() => {
      expandTimer.current = null;
      if (session.current && latest.current.isCollapsedDir(hoveredDir)) {
        latest.current.onExpandDir?.(hoveredDir);
      }
    }, AUTO_EXPAND_MS);
  };

  /** Re-reads what is under the pointer; also after the pane scrolled beneath a still pointer. */
  const retarget = (x: number, y: number, items: string[]) => {
    const target = dropTargetAt(elementAt(x, y), paneRef.current, latest.current.rootPath);
    update({
      items,
      target: target?.dir ?? null,
      valid: target !== null && canDropInto(items, target.dir),
    });
    scheduleExpand(target?.hoveredDir ?? null);
  };

  const edgeScroll = (x: number, y: number, items: string[]) => {
    const pane = paneRef.current;
    const rect = pane?.getBoundingClientRect();
    // Only inside the pane: the toolbar above it is not a scroll zone.
    const inside = !!rect && rect.height > 0 && y >= rect.top && y <= rect.bottom;
    const step = !inside
      ? 0
      : y < rect.top + EDGE_SCROLL_ZONE_PX
        ? -EDGE_SCROLL_STEP_PX
        : y > rect.bottom - EDGE_SCROLL_ZONE_PX
          ? EDGE_SCROLL_STEP_PX
          : 0;
    clearScroll();
    if (step === 0 || !pane) return;
    scrollTimer.current = setInterval(() => {
      pane.scrollTop += step;
      retarget(x, y, items);
    }, EDGE_SCROLL_INTERVAL_MS);
  };

  const track = (x: number, y: number, items: string[]) => {
    pointer.current = { x, y };
    retarget(x, y, items);
    edgeScroll(x, y, items);
    placeGhost(ghost.current, x, y);
  };

  const onMouseMove = (e: MouseEvent) => {
    const start = pending.current;
    if (!start) return;
    // The release was lost (Cmd+Tab, released over a native overlay): no
    // button is held any more, so the drag is over rather than stuck.
    if (e.buttons === 0) {
      end();
      return;
    }
    if (!session.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      const { selectedPaths: paths, selectedPath: primary } = latest.current;
      document.body.style.userSelect = 'none';
      track(e.clientX, e.clientY, dragItems(paths, primary, start.path));
      return;
    }
    e.preventDefault();
    track(e.clientX, e.clientY, session.current.items);
  };

  const onMouseUp = (e: MouseEvent) => {
    const finished = session.current;
    if (finished) {
      // The release ends a drag, not a click: keep the row under the pointer
      // from also opening or selecting itself.
      swallowNextClick();
      const target = dropTargetAt(
        elementAt(e.clientX, e.clientY),
        paneRef.current,
        latest.current.rootPath
      );
      if (target && canDropInto(finished.items, target.dir)) {
        latest.current.onMoveNodes?.(finished.items, target.dir);
      }
    }
    end();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !session.current) return;
    e.preventDefault();
    e.stopPropagation();
    end();
  };

  const startPress = (path: string, e: React.MouseEvent) => {
    if (e.button !== 0 || !latest.current.onMoveNodes) return;
    end();
    pending.current = { path, x: e.clientX, y: e.clientY };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', end);
    detach.current = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', end);
    };
  };
  // Every row receives this; a new function per render would re-render every
  // memoized row on each scroll tick. The press itself only reads refs.
  const startPressRef = useRef(startPress);
  useEffect(() => {
    startPressRef.current = startPress;
  });
  const onRowMouseDown = useCallback(
    (path: string, e: React.MouseEvent) => startPressRef.current(path, e),
    []
  );

  return { drag, ghostRef, onRowMouseDown };
}

function placeGhost(node: HTMLElement | null, x: number, y: number) {
  if (node) node.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
}

function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // No click follows when the release landed on another element than the press.
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

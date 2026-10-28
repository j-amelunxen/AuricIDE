import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ScheduleRun } from '@/lib/notifications/scheduleCalendar';

/**
 * Moving a run by dragging it to another slot, in the calendar or the timeline.
 *
 * Built on pointer events rather than HTML5 drag-and-drop for the reason the
 * explorer's drag is (`useTreeDrag.ts`): Tauri's native drop handler takes
 * every drag session over the webview, so `dragover`/`drop` never reach the
 * page. The view says what is under the pointer (`resolveTarget`) and what a
 * drop means (`onDrop`); this hook owns the press, the threshold, Escape and
 * the cleanup.
 */

/** Pixels the pointer travels before a press becomes a drag (a click stays a click). */
export const RUN_DRAG_THRESHOLD_PX = 4;

export interface RunDragState {
  run: ScheduleRun;
  /** The instant under the pointer, or `null` outside any slot. */
  targetAt: number | null;
  /** Whether a drop there would be accepted. */
  valid: boolean;
}

export interface UseRunDragOptions {
  /** The instant a slot at this screen position stands for, or `null` for none. */
  resolveTarget: (x: number, y: number) => number | null;
  /** A drop that would be refused (the past) shows a not-allowed cursor and does nothing. */
  isValidTarget: (at: number) => boolean;
  onDrop: (run: ScheduleRun, targetAt: number) => void;
}

export function useRunDrag({ resolveTarget, isValidTarget, onDrop }: UseRunDragOptions) {
  const [drag, setDrag] = useState<RunDragState | null>(null);
  // The window listeners outlive any one render; they read the latest callbacks here.
  const latest = useRef({ resolveTarget, isValidTarget, onDrop });
  useEffect(() => {
    latest.current = { resolveTarget, isValidTarget, onDrop };
  });
  const detach = useRef<(() => void) | null>(null);

  useEffect(() => () => detach.current?.(), []);

  const begin = useCallback((event: ReactPointerEvent, run: ScheduleRun) => {
    if (event.button !== 0) return;
    detach.current?.();
    const origin = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let target: number | null = null;
    let valid = false;
    let announced = false;

    const end = () => {
      detach.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      setDrag(null);
    };

    // The click that follows a drop lands on whatever is under the pointer —
    // a cell that would open "new schedule". A drag must not also be a click.
    const swallowClick = () => {
      const release = () => window.removeEventListener('click', stop, true);
      const stop = (e: Event) => {
        e.stopPropagation();
        release();
      };
      window.addEventListener('click', stop, true);
      setTimeout(release, 0);
    };

    function onMove(e: PointerEvent) {
      if (!dragging) {
        if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < RUN_DRAG_THRESHOLD_PX) return;
        dragging = true;
        document.body.style.userSelect = 'none';
      }
      const next = latest.current.resolveTarget(e.clientX, e.clientY);
      const nextValid = next !== null && latest.current.isValidTarget(next);
      document.body.style.cursor = next !== null && !nextValid ? 'not-allowed' : 'grabbing';
      if (announced && next === target && nextValid === valid) return;
      announced = true;
      target = next;
      valid = nextValid;
      setDrag({ run, targetAt: next, valid: nextValid });
    }

    function onUp() {
      const drop = dragging && valid && target !== null && target !== run.at ? target : null;
      if (dragging) swallowClick();
      end();
      if (drop !== null) latest.current.onDrop(run, drop);
    }

    function onCancel() {
      if (dragging) swallowClick();
      end();
    }

    // Capture phase and stopped: the Command Center's own Escape would close
    // the whole center, and a half-made drag is not worth that.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !dragging) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    detach.current = end;
  }, []);

  return { drag, begin };
}

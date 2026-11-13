/** Pixels the pointer travels before a press becomes a drag; a smaller move stays a click. */
export const DRAG_THRESHOLD_PX = 4;

/** Whether the pointer has moved far enough from where it was pressed to count as a drag. */
export function pastDragThreshold(
  origin: { x: number; y: number },
  pointer: { clientX: number; clientY: number }
): boolean {
  return Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) >= DRAG_THRESHOLD_PX;
}

/**
 * Stops the click that ends a drag. The browser still sends it to whatever is
 * under the pointer, which would act on it (open, select) as if it were clicked.
 * When the release lands on another element than the press no click follows,
 * so the listener only lives until the current task ends.
 */
export function swallowNextClick(): void {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

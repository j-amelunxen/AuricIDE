export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: ViewTransform = { scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

/** Multiply the scale by `factor` around `anchor`, so that point stays under the cursor. */
export function zoomAt(
  view: ViewTransform,
  factor: number,
  anchor: { x: number; y: number }
): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  if (scale === view.scale) return view;
  const ratio = scale / view.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
}

export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

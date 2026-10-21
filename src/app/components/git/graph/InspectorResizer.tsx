import { useRef } from 'react';

export const INSPECTOR_MIN_WIDTH = 280;
export const INSPECTOR_MAX_WIDTH = 560;
export const INSPECTOR_DEFAULT_WIDTH = 340;
const KEY_STEP = 16;

export const clampInspectorWidth = (width: number): number =>
  Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(width)));

interface InspectorResizerProps {
  width: number;
  onChange: (width: number) => void;
  /** Called once a drag or key press has settled, so the width can be remembered. */
  onCommit: (width: number) => void;
}

/** The inspector sits on the right, so dragging left makes it wider. */
export function InspectorResizer({ width, onChange, onCommit }: InspectorResizerProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const set = (next: number, commit: boolean) => {
    const clamped = clampInspectorWidth(next);
    onChange(clamped);
    if (commit) onCommit(clamped);
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.userSelect = '';
    onCommit(width);
  };

  const KEY_TARGETS: Record<string, number> = {
    ArrowLeft: width + KEY_STEP,
    ArrowRight: width - KEY_STEP,
    Home: INSPECTOR_MIN_WIDTH,
    End: INSPECTOR_MAX_WIDTH,
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector"
      aria-valuenow={width}
      aria-valuemin={INSPECTOR_MIN_WIDTH}
      aria-valuemax={INSPECTOR_MAX_WIDTH}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className="group relative w-px shrink-0 cursor-col-resize bg-white/5 before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:content-[''] hover:bg-primary/40 focus-visible:bg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: width };
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        if (drag.current) set(drag.current.startWidth - (e.clientX - drag.current.startX), false);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => set(INSPECTOR_DEFAULT_WIDTH, true)}
      onKeyDown={(e) => {
        if (!(e.key in KEY_TARGETS)) return;
        e.preventDefault();
        set(KEY_TARGETS[e.key], true);
      }}
    />
  );
}

export function parseStoredInspectorWidth(raw: string | null): number {
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? clampInspectorWidth(value) : INSPECTOR_DEFAULT_WIDTH;
}

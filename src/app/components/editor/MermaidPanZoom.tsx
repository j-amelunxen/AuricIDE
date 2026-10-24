'use client';

import { useCallback, useRef, useState } from 'react';
import { IDENTITY_VIEW, panBy, zoomAt, type ViewTransform } from '@/lib/mermaid/panZoom';

export interface MermaidPanZoomProps {
  svg: string;
  /** Fullscreen zooms with the plain wheel; inline needs Ctrl/Cmd so the page still scrolls. */
  wheelZoom: 'always' | 'modifier';
  className?: string;
  /** Sizing of the SVG inside the frame: inline caps the height, fullscreen fills the viewport. */
  contentClassName?: string;
}

const BUTTON =
  'flex h-7 w-7 items-center justify-center rounded border border-border-dark bg-surface-dark text-sm text-slate-200 hover:bg-slate-700';

export function MermaidPanZoom({
  svg,
  wheelZoom,
  className = '',
  contentClassName = '',
}: MermaidPanZoomProps): React.JSX.Element {
  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const anchorOf = useCallback((clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  }, []);

  const zoomFromCentre = (factor: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    const centre = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
    setView((v) => zoomAt(v, factor, centre));
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        ref={frameRef}
        data-testid="mermaid-panzoom-frame"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onWheel={(e) => {
          if (wheelZoom === 'modifier' && !e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const factor = Math.exp(-e.deltaY * 0.0015);
          setView((v) => zoomAt(v, factor, anchorOf(e.clientX, e.clientY)));
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          const dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((v) => panBy(v, dx, dy));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => setView(IDENTITY_VIEW)}
      >
        <div
          data-testid="mermaid-panzoom-content"
          className={`w-full ${contentClassName}`}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="absolute right-2 top-2 flex gap-1" role="group" aria-label="Zoom">
        <button
          type="button"
          className={BUTTON}
          aria-label="Zoom in"
          onClick={() => zoomFromCentre(1.25)}
        >
          {'+'}
        </button>
        <button
          type="button"
          className={BUTTON}
          aria-label="Zoom out"
          onClick={() => zoomFromCentre(0.8)}
        >
          {'−'}
        </button>
        <button
          type="button"
          className={`${BUTTON} w-auto px-2 text-xs`}
          aria-label="Reset zoom"
          onClick={() => setView(IDENTITY_VIEW)}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

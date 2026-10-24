'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { MermaidPanZoom } from './MermaidPanZoom';

export interface MermaidPreviewProps {
  code: string;
  /** Extra controls rendered next to Expand (e.g. the opt-in canvas editor switch). */
  toolbarExtra?: React.ReactNode;
}

let idCounter = 0;

// The mermaid bundle is large and only needed once a diagram is on screen, so it
// loads on first use rather than with the editor chunk.
async function loadMermaid() {
  const mod = await import('mermaid');
  const mermaid = mod.default;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#0c1219',
      primaryColor: '#137fec',
      primaryTextColor: '#e2e8f0',
      lineColor: '#2a3b4d',
      secondaryColor: '#151e29',
    },
  });
  return mermaid;
}

function MermaidFullscreen({ svg, onClose }: { svg: string; onClose: () => void }) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={dialogRef}
      className="flowchart-fullscreen-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Diagram fullscreen"
    >
      <MermaidPanZoom
        svg={svg}
        wheelZoom="always"
        className="h-full w-full"
        contentClassName="h-full [&>svg]:h-full [&>svg]:w-full [&>svg]:!max-w-none"
      />
      <button
        type="button"
        className="flowchart-expand-btn absolute left-4 top-4"
        onClick={onClose}
        aria-label="Close fullscreen"
      >
        {'✕'} Close
      </button>
    </div>,
    document.body
  );
}

export function MermaidPreview({ code, toolbarExtra }: MermaidPreviewProps): React.JSX.Element {
  // One state for one answer, tagged with the code it answers. Deriving the
  // three display values from it means the effect never sets state on the way
  // in — and a slow render of an older diagram can no longer land on top of a
  // newer one, which the previous three separate flags allowed.
  const [rendered, setRendered] = useState<{
    code: string;
    svg: string | null;
    error: string | null;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isCurrent = rendered?.code === code;
  const loading = !isCurrent;
  const svg = isCurrent ? rendered.svg : null;
  const error = isCurrent ? rendered.error : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `mermaid-diagram-${idCounter++}`;
        const result = await mermaid.render(id, code);
        if (!cancelled) setRendered({ code, svg: result.svg, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to render diagram';
        if (!cancelled) setRendered({ code, svg: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div
      ref={containerRef}
      data-testid="mermaid-preview"
      className="relative my-2 rounded-lg border border-border-dark bg-background-dark p-4"
    >
      {loading && <p className="animate-pulse text-sm text-slate-400">Rendering diagram...</p>}
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      {svg && (
        <>
          <div className="mb-2 flex justify-end gap-2">
            {toolbarExtra}
            <button
              type="button"
              className="flowchart-expand-btn"
              onClick={() => setIsFullscreen(true)}
              aria-label="Expand"
            >
              <AuricIcon name="open_in_full" /> Expand
            </button>
          </div>
          <MermaidPanZoom
            svg={svg}
            wheelZoom="modifier"
            className="w-full"
            contentClassName="[&>svg]:mx-auto [&>svg]:max-h-[70vh] [&>svg]:max-w-full"
          />
          {isFullscreen && <MermaidFullscreen svg={svg} onClose={() => setIsFullscreen(false)} />}
        </>
      )}
      {!svg && error && toolbarExtra && <div className="mt-2 flex justify-end">{toolbarExtra}</div>}
    </div>
  );
}

'use client';

import mermaid from 'mermaid';
import { useEffect, useRef, useState } from 'react';

export interface MermaidPreviewProps {
  code: string;
}

let idCounter = 0;

export function MermaidPreview({ code }: MermaidPreviewProps): React.JSX.Element {
  // One state for one answer, tagged with the code it answers. Deriving the
  // three display values from it means the effect never sets state on the way
  // in — and a slow render of an older diagram can no longer land on top of a
  // newer one, which the previous three separate flags allowed.
  const [rendered, setRendered] = useState<{
    code: string;
    svg: string | null;
    error: string | null;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isCurrent = rendered?.code === code;
  const loading = !isCurrent;
  const svg = isCurrent ? rendered.svg : null;
  const error = isCurrent ? rendered.error : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
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
      className="my-2 rounded-lg border border-border-dark bg-background-dark p-4"
    >
      {loading && <p className="animate-pulse text-sm text-slate-400">Rendering diagram...</p>}
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
      {svg && (
        <div
          className="flex max-w-full items-center justify-center [&>svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}

'use client';

import mermaid from 'mermaid';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface MermaidPreviewProps {
  code: string;
}

let idCounter = 0;

export function MermaidPreview({ code }: MermaidPreviewProps): React.JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderDiagram = useCallback(async (mermaidCode: string) => {
    setLoading(true);
    setError(null);
    setSvg(null);

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
      const result = await mermaid.render(id, mermaidCode);
      setSvg(result.svg);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to render diagram';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    renderDiagram(code);
  }, [code, renderDiagram]);

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

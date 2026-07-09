'use client';

import { useState } from 'react';

interface HtmlViewerProps {
  /** Raw HTML source of the file. */
  content: string;
  fileName: string;
}

type Mode = 'preview' | 'source';

/**
 * Reads an .html file inside the IDE — rendered preview by default (so
 * drilldown reports are legible without leaving the app) with a raw-source
 * toggle. The preview runs in a sandboxed iframe with no same-origin access,
 * so a document's scripts can't reach the IDE.
 */
export function HtmlViewer({ content, fileName }: HtmlViewerProps) {
  const [mode, setMode] = useState<Mode>('preview');

  return (
    <div data-testid="html-viewer" className="flex h-full flex-col bg-editor-bg">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 glass">
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[16px] text-orange-600"
          >
            html
          </span>
          <span className="font-medium text-foreground">{fileName}</span>
        </div>
        <div
          role="group"
          aria-label="View mode"
          className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/20 p-0.5"
        >
          {(['preview', 'source'] as const).map((m) => {
            const active = mode === m;
            const label = m === 'preview' ? 'Preview' : 'Source';
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={active}
                className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors duration-150 ${
                  active
                    ? 'bg-primary/20 text-primary-light'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'preview' ? (
          <iframe
            title={`Preview of ${fileName}`}
            srcDoc={content}
            sandbox="allow-scripts allow-popups allow-forms"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <pre className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground-muted">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

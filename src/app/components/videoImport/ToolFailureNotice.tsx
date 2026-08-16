'use client';

import type { ToolFailure } from '@/lib/videoImport/toolFailure';

/**
 * How a failed command is allowed to appear.
 *
 * The alert carries the sentence and nothing else — a traceback in the role
 * that announces itself to a screen reader is noise at best. The output stays
 * available one click away, in monospace where it is actually legible, and the
 * log path is named for the cases where forty lines were not enough.
 */
export function ToolFailureNotice({ failure }: { failure: ToolFailure | null }) {
  if (!failure) return null;
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5">
      <p role="alert" className="text-[11px] leading-relaxed text-red-300">
        {failure.summary}
      </p>
      {failure.details && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-[10px] font-semibold text-red-300/70 transition-colors hover:text-red-300">
            Technical details
          </summary>
          <pre className="mt-1.5 max-h-56 overflow-auto rounded border border-white/5 bg-black/40 p-2 font-mono text-[10px] leading-snug text-foreground-muted whitespace-pre-wrap break-words">
            {failure.details}
          </pre>
        </details>
      )}
      {failure.logPath && (
        <p className="mt-1.5 font-mono text-[9px] text-foreground-muted/70 break-all">
          Full log: {failure.logPath}
        </p>
      )}
    </div>
  );
}

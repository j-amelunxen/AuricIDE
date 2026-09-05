'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { ccUsageReport, type CcUsageReport, type UsageWindowId } from '@/lib/usage/ccUsage';
import { WINDOW_ORDER } from './report/formatters';
import { WindowPanel } from './report/WindowPanel';

/**
 * What has actually been spent, over 24 hours to 30 days.
 *
 * Two things govern the design, and both are about honesty rather than looks.
 *
 * **Every figure is reported against the period before it.** A bare total
 * answers "how much" and leaves "compared to what?" — the question that makes
 * it readable — unanswered. Where the transcripts do not reach far enough back
 * to make that comparison, none is shown: an absent period rendered as a quiet
 * one would make every figure from a new install read as a surge.
 *
 * **Every breakdown row carries its own time series, on one shared scale.**
 * That makes the breakdown a set of small multiples rather than a ranked list —
 * the same shape over the same axis, so a spike in one row is directly
 * comparable to a spike in another, and a quiet row genuinely renders quiet.
 * The percentage bar this replaced encoded strictly less: share only, with the
 * time axis thrown away, for the same ink.
 *
 * The panel's one job that is not display: keeping the reader from mistaking a
 * list-price total for an invoice. A transcript records tokens, not what the
 * account was billed, so the only rate it can be priced at is the published
 * one. On a subscription the real charge is the subscription. That is said
 * once, where the figure is, rather than hedged in a footnote nobody reads.
 */
export function UsageReportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return <UsageReportDialog onClose={onClose} />;
}

function UsageReportDialog({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<CcUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UsageWindowId>('24h');
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'cc-usage-report', kind: 'tool', active: true, onEscape: onClose });

  const fetchReport = useCallback((force: boolean) => {
    return ccUsageReport({ force })
      .then((next) => {
        setReport(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        // The message from Rust names what went wrong; replacing it with
        // "could not load usage" would throw that away.
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
  }, []);

  // `loading` already starts true, so the first read sets no state on the way
  // in — only on the way out, from the promise.
  useEffect(() => {
    void fetchReport(false);
  }, [fetchReport]);

  const rescan = () => {
    setLoading(true);
    void fetchReport(true);
  };

  const window = report?.windows.find((entry) => entry.id === selected) ?? null;

  // Portalled to the body: the chip lives inside the status bar's `.glass`
  // footer, whose backdrop-blur makes it a containing block for `fixed`
  // descendants. Left inline, this dialog's `inset-0` resolves against that
  // 32px-tall footer instead of the viewport — a backdrop confined to the
  // status bar rather than covering the screen.
  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-start justify-center bg-black/50 p-6 backdrop-blur-sm sm:p-10"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="CLI usage report"
        data-testid="usage-report-modal"
        className="glass-card flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-white/5 px-5 py-3.5">
          <AuricIcon name="analytics" className="text-foreground-muted" />
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-semibold text-foreground">Usage</h2>
            <span className="truncate text-[10px] text-foreground-muted">
              {report ? report.pluginName : 'Reading transcripts…'}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-testid="usage-report-refresh"
              aria-label="Rescan transcripts"
              disabled={loading}
              onClick={rescan}
              className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50"
            >
              <AuricIcon
                name="refresh"
                className={`text-[13px] ${loading ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              aria-label="Close usage report"
              onClick={onClose}
              className="rounded p-1.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <AuricIcon name="close" className="text-[13px]" />
            </button>
          </div>
        </header>

        {report && (
          <nav
            aria-label="Reporting period"
            className="flex items-center gap-1 border-b border-white/5 px-5 py-2"
          >
            {WINDOW_ORDER.map((id) => {
              const entry = report.windows.find((candidate) => candidate.id === id);
              if (!entry) return null;
              const active = id === selected;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`usage-window-${id}`}
                  aria-pressed={active}
                  onClick={() => setSelected(id)}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-primary/20 text-foreground'
                      : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  {entry.label}
                </button>
              );
            })}
            {/* Switching periods is free — all four come from one scan — so the
                cost of the scan is stated once, here, rather than per tab. */}
            <span className="ml-auto text-[9px] text-foreground-muted/70">
              {report.filesScanned.toLocaleString()} transcripts · {report.scanMs} ms
            </span>
          </nav>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {error}
            </p>
          )}
          {!error && loading && !report && (
            <p className="py-10 text-center text-[11px] text-foreground-muted">
              Reading transcripts…
            </p>
          )}
          {!error && report && window && <WindowPanel report={report} window={window} />}
        </div>
      </div>
    </div>,
    document.body
  );
}

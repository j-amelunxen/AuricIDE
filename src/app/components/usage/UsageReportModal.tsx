'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import {
  billableTokens,
  cacheReadShare,
  costPerSession,
  costPerTurn,
  formatCost,
  formatTokens,
  peakBucket,
  projectedMonthlyCost,
  shareOf,
  sidechainShare,
  thinkingShare,
  tokenClasses,
} from '@/lib/usage/breakdown';
import { changeAgainst, sparklineArea, sparklinePath } from '@/lib/usage/sparkline';
import {
  ccUsageReport,
  type CcUsageReport,
  type UsageBucket,
  type UsageNamedAggregate,
  type UsageWindowId,
  type UsageWindowReport,
} from '@/lib/usage/ccUsage';

const WINDOW_ORDER: UsageWindowId[] = ['24h', '3d', '7d', '30d'];

/** Word-sized, per Tufte: a series that reads inline with its own row. */
const SPARK = { width: 132, height: 16 };
/** The macro view. Taller, because it is the one the eye lands on first. */
const CHART_HEIGHT = 64;
/** How many breakdown rows are drawn before the tail is summarised. */
const ROWS_SHOWN = 8;

const CLASS_TONES = [
  'bg-primary/70',
  'bg-primary/50',
  'bg-primary/35',
  'bg-primary/25',
  'bg-primary/15',
];

function percent(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

function signedPercent(ratio: number): string {
  const magnitude = Math.abs(ratio);
  return `${ratio >= 0 ? '+' : '−'}${(magnitude * 100).toFixed(magnitude < 0.1 ? 1 : 0)}%`;
}

function bucketLabel(startsAt: number, bucketSeconds: number): string {
  const at = new Date(startsAt * 1000);
  if (bucketSeconds >= 24 * 3600) {
    return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function intervalLabel(bucketSeconds: number): string {
  return bucketSeconds >= 86400 ? `${bucketSeconds / 86400} day` : `${bucketSeconds / 3600} h`;
}

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

function WindowPanel({ report, window }: { report: CcUsageReport; window: UsageWindowReport }) {
  const { currency } = report;

  if (window.totals.messages === 0) {
    return (
      <p
        data-testid="usage-window-empty"
        className="py-10 text-center text-[11px] text-foreground-muted"
      >
        Nothing recorded in the last {window.label}.
      </p>
    );
  }

  const change = changeAgainst(window.totals.cost, window.previous?.cost ?? null);
  const peak = peakBucket(window);
  const projected = projectedMonthlyCost(window);
  // One ceiling for the macro chart and every row below it, so a height means
  // the same thing everywhere on the page.
  const ceiling = window.buckets.reduce((highest, bucket) => Math.max(highest, bucket.cost), 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <span className="text-[9px] uppercase tracking-wide text-foreground-muted">
          At list price
        </span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span data-testid="usage-total-cost" className="font-mono text-3xl text-foreground">
            {formatCost(window.totals.cost, currency)}
          </span>
          {change ? (
            <span
              data-testid="usage-change"
              className={`text-[11px] ${
                change.direction === 'flat'
                  ? 'text-foreground-muted'
                  : change.direction === 'up'
                    ? 'text-amber-300'
                    : 'text-emerald-300'
              }`}
            >
              {change.direction === 'flat' ? 'level with' : signedPercent(change.ratio)} the
              previous {window.label}
              <span className="ml-1.5 font-mono text-foreground-muted/70">
                {formatCost(window.previous?.cost ?? 0, currency)}
              </span>
            </span>
          ) : (
            // Not a hedge: the transcripts genuinely do not span the earlier
            // period, and drawing it as quiet would invent an increase.
            <span data-testid="usage-no-comparison" className="text-[11px] text-foreground-muted">
              no earlier {window.label} on record to compare with
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-muted">
          {formatTokens(billableTokens(window.totals.counts))} tokens ·{' '}
          {window.totals.messages.toLocaleString()} turns · {window.sessions.toLocaleString()}{' '}
          sessions · {window.projects.length.toLocaleString()} projects
        </p>
      </section>

      {/* The one thing this panel must not let the reader get wrong. */}
      <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[10px] leading-relaxed text-amber-200/90">
        These are <strong>published API rates</strong> applied to the tokens in your transcripts —
        what this work would have cost through the API. A Claude subscription bills the
        subscription, not this. Read it as a measure of how much you are using, not as an invoice.
      </p>

      <MacroChart window={window} currency={currency} ceiling={ceiling} peak={peak} />

      <Breakdown
        title="By model"
        rows={window.models}
        window={window}
        ceiling={ceiling}
        currency={currency}
      />
      <Breakdown
        title="By project"
        rows={window.projects}
        window={window}
        ceiling={ceiling}
        currency={currency}
      />

      <TokenComposition window={window} />

      <section className="grid gap-x-8 gap-y-3 border-t border-white/5 pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Saved by prompt cache"
          value={formatCost(window.totals.cacheSaving, currency)}
          hint={`${percent(cacheReadShare(window))} of input came from cache`}
        />
        <Fact
          label="Per session"
          value={formatCost(costPerSession(window), currency)}
          hint={`${formatCost(costPerTurn(window), currency)} per turn`}
        />
        <Fact
          label="Reasoning"
          value={percent(thinkingShare(window))}
          hint={`${formatTokens(window.totals.counts.thinking)} thinking tokens, inside output`}
        />
        <Fact
          label="Sub-agents"
          value={percent(sidechainShare(window))}
          hint={`${window.sidechainMessages.toLocaleString()} of ${window.totals.messages.toLocaleString()} turns`}
        />
        {projected !== null && (
          <Fact
            label="At this rate"
            value={formatCost(projected, currency)}
            hint="projected over 30 days"
          />
        )}
        {window.totals.counts.webSearchRequests > 0 && (
          <Fact
            label="Web searches"
            value={window.totals.counts.webSearchRequests.toLocaleString()}
            hint="billed per request, not per token"
          />
        )}
      </section>

      {window.unpricedModels.length > 0 && (
        <p
          data-testid="usage-unpriced"
          className="text-[10px] leading-relaxed text-amber-200/80"
          role="note"
        >
          No rate for {window.unpricedModels.join(', ')} — their tokens are counted above but their
          cost is not, so the total understates. Add them to{' '}
          <code className="rounded bg-white/5 px-1">usage-plugins/{report.pluginId}.json</code>.
        </p>
      )}

      <footer className="text-[9px] leading-relaxed text-foreground-muted/60">
        {report.turnsRead.toLocaleString()} turns read across {report.filesScanned.toLocaleString()}{' '}
        transcripts
        {report.duplicatesDropped > 0 && (
          <>
            {' '}
            · {report.duplicatesDropped.toLocaleString()} counted once after appearing in more than
            one transcript
          </>
        )}
      </footer>
    </div>
  );
}

/**
 * The macro view: cost over the window.
 *
 * Range-framed rather than boxed — the only two values marked are the ceiling
 * and the baseline, each labelled with the number it stands for, so the chart
 * can be read rather than merely looked at. No gridlines: at this height they
 * would out-ink the data they are meant to serve.
 *
 * The peak is annotated above the plot, never inside it. Inside, its label
 * would sit exactly where the tallest bar already is.
 */
function MacroChart({
  window,
  currency,
  ceiling,
  peak,
}: {
  window: UsageWindowReport;
  currency: string;
  ceiling: number;
  peak: UsageBucket | null;
}) {
  if (ceiling <= 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] uppercase tracking-wide text-foreground-muted">
          Cost over {window.label}
        </h3>
        {peak && (
          <span className="text-[9px] text-foreground-muted/70">
            peak {formatCost(peak.cost, currency)} at{' '}
            {bucketLabel(peak.startsAt, window.bucketSeconds)}
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        <svg
          data-testid="usage-buckets"
          role="img"
          aria-label={`Cost per ${intervalLabel(window.bucketSeconds)} across the last ${window.label}, peaking at ${formatCost(ceiling, currency)}`}
          viewBox={`0 0 ${window.buckets.length} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          className="h-16 flex-1"
        >
          {window.buckets.map((bucket, index) => {
            const height = (bucket.cost / ceiling) * CHART_HEIGHT;
            return (
              <rect
                key={bucket.startsAt}
                x={index + 0.15}
                y={CHART_HEIGHT - height}
                width={0.7}
                height={height}
                className="fill-primary/60"
              >
                <title>
                  {bucketLabel(bucket.startsAt, window.bucketSeconds)} —{' '}
                  {formatCost(bucket.cost, currency)}, {bucket.messages} turns
                </title>
              </rect>
            );
          })}
        </svg>
        {/* The scale, outside the plot: two numbers, no ticks, no frame. */}
        <div className="flex w-16 shrink-0 flex-col justify-between py-px text-right font-mono text-[9px] text-foreground-muted/70">
          <span>{formatCost(ceiling, currency)}</span>
          <span>0</span>
        </div>
      </div>

      <div className="flex justify-between pr-[4.5rem] text-[9px] text-foreground-muted/60">
        <span>{bucketLabel(window.startsAt, window.bucketSeconds)}</span>
        <span>now</span>
      </div>
      {/* States the shared scale once, so the rows below can be compared
          without each carrying its own axis annotation. */}
      <p className="text-[9px] text-foreground-muted/50">
        {window.buckets.length} intervals of {intervalLabel(window.bucketSeconds)}. Every series
        below shares this scale.
      </p>
    </section>
  );
}

/**
 * The breakdown as small multiples: one row per model or project, each showing
 * the same series over the same axis and against the same ceiling as the chart
 * above.
 *
 * Still sorted by cost, so the ranking reads down the left edge — but the
 * sparkline also says *when*, which the percentage bar it replaced could not.
 */
function Breakdown({
  title,
  rows,
  window,
  ceiling,
  currency,
}: {
  title: string;
  rows: UsageNamedAggregate[];
  window: UsageWindowReport;
  ceiling: number;
  currency: string;
}) {
  const shown = rows.slice(0, ROWS_SHOWN);
  const rest = rows.slice(ROWS_SHOWN);
  const restCost = rest.reduce((sum, row) => sum + row.aggregate.cost, 0);

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] uppercase tracking-wide text-foreground-muted">{title}</h3>
      <ul className="flex flex-col">
        {shown.map((row) => (
          <li
            key={row.key}
            data-testid="usage-breakdown-row"
            className="flex items-center gap-3 border-b border-white/[0.04] py-1 last:border-0"
          >
            <span className="w-32 shrink-0 truncate text-[11px] text-foreground" title={row.key}>
              {row.label}
              {row.unpriced && <span className="ml-1.5 text-[9px] text-amber-300/80">no rate</span>}
            </span>

            <RowSparkline row={row} window={window} ceiling={ceiling} currency={currency} />

            {/* The cost, and nothing else. The row's rank, its sparkline
                height and this number all encode the same magnitude; a
                percentage beside them would be a fourth. The share is
                recoverable from the total above — the *when* is not
                recoverable from anything, which is why the sparkline stays. */}
            <span
              className="w-20 shrink-0 text-right font-mono text-[11px] text-foreground"
              title={`${percent(shareOf(row, window.totals.cost))} of the window`}
            >
              {formatCost(row.aggregate.cost, currency)}
            </span>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        // Truncating without saying so would make the column read as the whole
        // list, and the tail of a long-tail distribution is often the finding.
        <span className="text-[9px] text-foreground-muted/60">
          + {rest.length} more, {formatCost(restCost, currency)} together
        </span>
      )}
    </section>
  );
}

function RowSparkline({
  row,
  window,
  ceiling,
  currency,
}: {
  row: UsageNamedAggregate;
  window: UsageWindowReport;
  ceiling: number;
  currency: string;
}) {
  if (row.series.length === 0) {
    return <span className="flex-1" aria-hidden="true" />;
  }
  const box = { ...SPARK, max: ceiling };
  return (
    <svg
      data-testid={`usage-sparkline-${row.key}`}
      role="img"
      aria-label={`${row.label}: ${formatCost(row.aggregate.cost, currency)} across the last ${window.label}`}
      viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
      preserveAspectRatio="none"
      className="h-4 flex-1"
    >
      <path d={sparklineArea(row.series, box)} className="fill-primary/15" />
      <path
        d={sparklinePath(row.series, box)}
        fill="none"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-primary/70"
      />
    </svg>
  );
}

/**
 * Where the tokens went, as one part-to-whole bar rather than five separate
 * ones — the classes are parts of a single total, and five bars made the
 * reader add them up themselves.
 *
 * Labelled directly underneath rather than through a legend: words and images
 * belong together, and a legend is one more lookup for the same information.
 */
function TokenComposition({ window }: { window: UsageWindowReport }) {
  const classes = tokenClasses(window.totals.counts);
  const total = billableTokens(window.totals.counts);
  if (classes.length === 0 || total === 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] uppercase tracking-wide text-foreground-muted">
        Where the tokens went
      </h3>
      <div
        data-testid="usage-token-classes"
        className="flex h-2.5 w-full overflow-hidden rounded-sm"
        role="img"
        aria-label={classes
          .map((entry) => `${entry.label} ${percent(entry.tokens / total)}`)
          .join(', ')}
      >
        {classes.map((entry, index) => (
          <div
            key={entry.key}
            className={CLASS_TONES[index % CLASS_TONES.length]}
            style={{ width: `${(entry.tokens / total) * 100}%` }}
            title={`${entry.label}: ${formatTokens(entry.tokens)} (${entry.hint})`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-[9px] text-foreground-muted">
        {classes.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-[1px] ${CLASS_TONES[index % CLASS_TONES.length]}`}
            />
            {entry.label} {formatTokens(entry.tokens)}
            <span className="text-foreground-muted/50">{entry.hint}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-foreground-muted">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[9px] text-foreground-muted/70">{hint}</span>
    </div>
  );
}

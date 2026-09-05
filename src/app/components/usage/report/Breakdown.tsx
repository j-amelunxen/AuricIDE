import type { UsageNamedAggregate, UsageWindowReport } from '@/lib/usage/ccUsage';
import { formatCost, shareOf } from '@/lib/usage/breakdown';
import { sparklineArea, sparklinePath } from '@/lib/usage/sparkline';
import { percent } from './formatters';

/** Word-sized, per Tufte: a series that reads inline with its own row. */
const SPARK = { width: 132, height: 16 };
/** How many breakdown rows are drawn before the tail is summarised. */
const ROWS_SHOWN = 8;

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
 * The breakdown as small multiples: one row per model or project, each showing
 * the same series over the same axis and against the same ceiling as the chart
 * above.
 *
 * Still sorted by cost, so the ranking reads down the left edge — but the
 * sparkline also says *when*, which the percentage bar it replaced could not.
 */
export function Breakdown({
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

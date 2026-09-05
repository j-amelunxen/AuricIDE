import type { UsageBucket, UsageWindowReport } from '@/lib/usage/ccUsage';
import { formatCost } from '@/lib/usage/breakdown';
import { bucketLabel, intervalLabel } from './formatters';

/** The macro view. Taller, because it is the one the eye lands on first. */
const CHART_HEIGHT = 64;

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
export function MacroChart({
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

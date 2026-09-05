import type { CcUsageReport, UsageWindowReport } from '@/lib/usage/ccUsage';
import {
  billableTokens,
  cacheReadShare,
  costPerSession,
  costPerTurn,
  formatCost,
  formatTokens,
  peakBucket,
  projectedMonthlyCost,
  sidechainShare,
  thinkingShare,
} from '@/lib/usage/breakdown';
import { changeAgainst } from '@/lib/usage/sparkline';
import { percent, signedPercent } from './formatters';
import { MacroChart } from './MacroChart';
import { Breakdown } from './Breakdown';
import { TokenComposition } from './TokenComposition';

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wide text-foreground-muted">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
      <span className="text-[9px] text-foreground-muted/70">{hint}</span>
    </div>
  );
}

export function WindowPanel({
  report,
  window,
}: {
  report: CcUsageReport;
  window: UsageWindowReport;
}) {
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

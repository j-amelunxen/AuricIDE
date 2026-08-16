/**
 * Everything the usage panel derives from a report, and nothing it fetches.
 *
 * The backend already computed every figure that depends on a price list, so
 * nothing here multiplies a token by a rate — that would be a second
 * implementation of the pricing, free to drift from the first. What is left is
 * ratios, averages and formatting: arithmetic over numbers that are already
 * authoritative.
 */

import type { UsageNamedAggregate, UsageTokenCounts, UsageWindowReport } from './ccUsage';

/**
 * Everything the API charged for, counted once.
 *
 * The Rust twin is `TokenCounts::billable`, which is a method and so does not
 * survive serialization — this is the only place the sum is re-expressed, and
 * it must agree with that one. `thinking` is excluded on both sides because it
 * is already inside `output`.
 */
export function billableTokens(counts: UsageTokenCounts): number {
  return (
    counts.input + counts.output + counts.cacheWrite5m + counts.cacheWrite1h + counts.cacheRead
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/**
 * A cost, at the precision that keeps it honest.
 *
 * Two decimals for anything that reads as money, and more for the amounts a
 * cheap model produces — "$0.00" beside a row that plainly did work reads as a
 * broken panel rather than as a small number.
 */
export function formatCost(cost: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  const magnitude = Math.abs(cost);

  let text: string;
  if (magnitude === 0 || magnitude >= 0.005) {
    text = cost.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } else if (magnitude >= 0.0005) {
    text = cost.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  } else {
    return symbol ? `<${symbol}0.001` : `<0.001 ${currency}`;
  }

  return symbol ? `${symbol}${text}` : `${text} ${currency}`;
}

/** A token count at a glance: `14.5B` rather than `14496236359`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (tokens < 1_000_000_000) {
    return `${(tokens / 1_000_000).toPrecision(3).replace(/\.?0+$/, '')}M`;
  }
  return `${(tokens / 1_000_000_000).toPrecision(3).replace(/\.?0+$/, '')}B`;
}

export interface TokenClass {
  key: 'input' | 'output' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheRead';
  label: string;
  /** What this class costs relative to a plain input token. */
  hint: string;
  tokens: number;
}

/**
 * The token total split into the classes that are billed at different rates,
 * largest first.
 *
 * Thinking is deliberately absent: it is a subset of output, so listing it
 * here would make the parts sum to more than the whole. It gets its own share
 * instead (see {@link thinkingShare}).
 */
export function tokenClasses(counts: UsageTokenCounts): TokenClass[] {
  const classes: TokenClass[] = [
    { key: 'input', label: 'Input', hint: 'base rate', tokens: counts.input },
    { key: 'output', label: 'Output', hint: 'output rate', tokens: counts.output },
    {
      key: 'cacheWrite5m',
      label: 'Cache write 5m',
      hint: '1.25× input',
      tokens: counts.cacheWrite5m,
    },
    {
      key: 'cacheWrite1h',
      label: 'Cache write 1h',
      hint: '2× input',
      tokens: counts.cacheWrite1h,
    },
    { key: 'cacheRead', label: 'Cache read', hint: '0.1× input', tokens: counts.cacheRead },
  ];
  return classes
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/** How much of everything that went in came from the cache rather than fresh. */
export function cacheReadShare(window: UsageWindowReport): number {
  const { counts } = window.totals;
  const totalInput = counts.input + counts.cacheWrite5m + counts.cacheWrite1h + counts.cacheRead;
  return ratio(counts.cacheRead, totalInput);
}

/** How much of the output was reasoning. */
export function thinkingShare(window: UsageWindowReport): number {
  return ratio(window.totals.counts.thinking, window.totals.counts.output);
}

/** How much of the work was done by sub-agents rather than the main thread. */
export function sidechainShare(window: UsageWindowReport): number {
  return ratio(window.sidechainMessages, window.totals.messages);
}

export function costPerTurn(window: UsageWindowReport): number {
  return ratio(window.totals.cost, window.totals.messages);
}

export function costPerSession(window: UsageWindowReport): number {
  return ratio(window.totals.cost, window.sessions);
}

/** A row's slice of the window, for the bar beside it. */
export function shareOf(row: UsageNamedAggregate, windowCost: number): number {
  return ratio(row.aggregate.cost, windowCost);
}

const DAYS_PER_MONTH = 30;

/**
 * What thirty days at this window's rate would come to.
 *
 * Only offered for windows shorter than a month, and only when the window
 * actually carried spend. Projecting the 30-day window would restate a
 * measurement as a forecast, and projecting a quiet day would make "$0.00 per
 * month" look like a finding rather than an absence of data.
 */
export function projectedMonthlyCost(window: UsageWindowReport): number | null {
  const days = window.hours / 24;
  if (days >= DAYS_PER_MONTH) return null;
  if (window.totals.cost <= 0) return null;
  return (window.totals.cost / days) * DAYS_PER_MONTH;
}

/**
 * The costliest bucket in the window, or nothing if the window was idle.
 *
 * Every bucket is present in the report, quiet ones included, so a plain
 * "first by cost" would name an arbitrary empty hour as the peak.
 */
export function peakBucket(window: UsageWindowReport): UsageWindowReport['buckets'][number] | null {
  let peak: UsageWindowReport['buckets'][number] | null = null;
  for (const bucket of window.buckets) {
    if (bucket.cost <= 0 && bucket.messages === 0) continue;
    if (!peak || bucket.cost > peak.cost) peak = bucket;
  }
  return peak;
}

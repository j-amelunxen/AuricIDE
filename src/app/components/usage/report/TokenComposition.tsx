import type { UsageWindowReport } from '@/lib/usage/ccUsage';
import { billableTokens, formatTokens, tokenClasses } from '@/lib/usage/breakdown';
import { percent } from './formatters';

const CLASS_TONES = [
  'bg-primary/70',
  'bg-primary/50',
  'bg-primary/35',
  'bg-primary/25',
  'bg-primary/15',
];

/**
 * Where the tokens went, as one part-to-whole bar rather than five separate
 * ones — the classes are parts of a single total, and five bars made the
 * reader add them up themselves.
 *
 * Labelled directly underneath rather than through a legend: words and images
 * belong together, and a legend is one more lookup for the same information.
 */
export function TokenComposition({ window }: { window: UsageWindowReport }) {
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

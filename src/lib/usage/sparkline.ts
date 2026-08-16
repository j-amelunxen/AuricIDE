/**
 * Sparklines: a time series at the size of a word, drawn inline with the row
 * it belongs to.
 *
 * The point is not decoration. A ranked list with a percentage bar answers
 * "how much" and throws the time axis away; the same row with its own series
 * answers "how much, and when" in the same space. Because every row is scaled
 * against one shared maximum, a quiet row renders quiet — the comparison
 * between rows is the reading, not each row's own shape.
 */

export interface SparklineBox {
  width: number;
  height: number;
  /** The shared ceiling. Rows are scaled against this, never against their own peak. */
  max: number;
}

function points(values: number[], { width, height, max }: SparklineBox): [number, number][] {
  const ceiling = max > 0 ? max : 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = values.length > 1 ? index * step : 0;
    // SVG y grows downward, so the peak is the smallest y.
    const y = height - Math.min(1, Math.max(0, value / ceiling)) * height;
    return [x, y];
  });
}

function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** The line itself. Empty string for an empty series — nothing to draw. */
export function sparklinePath(values: number[], box: SparklineBox): string {
  const drawn = points(values, box);
  if (drawn.length === 0) return '';
  if (drawn.length === 1) {
    // A single bucket would otherwise be a zero-length path, which renders as
    // nothing at all. Extend it across the box so the value is still visible.
    const [, y] = drawn[0];
    return `M0,${round(y)}L${round(box.width)},${round(y)}`;
  }
  return drawn.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x)},${round(y)}`).join('');
}

/**
 * The same line closed down to the baseline, for a faint fill under it.
 *
 * The fill carries no information the line does not — it is there to let the
 * eye separate a row from its neighbours at this size, which the line alone
 * does not do reliably.
 */
export function sparklineArea(values: number[], box: SparklineBox): string {
  const line = sparklinePath(values, box);
  if (!line) return '';
  return `${line}L${round(box.width)},${round(box.height)}L0,${round(box.height)}Z`;
}

export interface Change {
  /** Signed relative change: 0.2 is twenty percent more than before. */
  ratio: number;
  direction: 'up' | 'down' | 'flat';
}

/** Anything smaller reads as noise, and an arrow on noise is a false claim. */
const FLAT_THRESHOLD = 0.01;

/**
 * How this period compares with the one before it.
 *
 * `null` where the comparison cannot be made honestly: no earlier period at
 * all, or an earlier period with no spend. Any increase over zero is an
 * infinite one, and "+∞%" is a division artefact rather than a finding.
 */
export function changeAgainst(current: number, previous: number | null): Change | null {
  if (previous === null || previous <= 0) return null;
  const ratio = (current - previous) / previous;
  if (Math.abs(ratio) < FLAT_THRESHOLD) return { ratio, direction: 'flat' };
  return { ratio, direction: ratio > 0 ? 'up' : 'down' };
}

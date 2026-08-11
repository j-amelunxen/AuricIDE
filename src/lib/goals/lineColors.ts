/**
 * The metro-line palette. Explicit hex, not theme tokens: a line must keep
 * its color whatever accent the user picked, for the same reason an agent's
 * marker does (src/lib/agents/colors.ts) — "the violet line" has to stay
 * violet, or the user's spatial memory of the board resets on every retheme.
 * Hues are tuned to stay distinct on the dark surface at 4px stroke width.
 */
export const LINE_HUES: readonly string[] = [
  '#b47dff', // violet
  '#ff6ec7', // pink
  '#4fd6e8', // cyan
  '#5ff0b4', // mint
  '#6b9bff', // blue
  '#ffa94f', // orange
  '#f5d76b', // gold
  '#9d8cff', // iris
  '#7ee081', // green
  '#ff8fa3', // rose
];

/**
 * Deterministic goal → hue mapping, so a line keeps its color across
 * sessions and machines without storing anything.
 */
export function lineHue(goalId: string): string {
  let hash = 5381;
  for (let i = 0; i < goalId.length; i++) {
    hash = ((hash << 5) + hash + goalId.charCodeAt(i)) | 0;
  }
  return LINE_HUES[Math.abs(hash) % LINE_HUES.length];
}

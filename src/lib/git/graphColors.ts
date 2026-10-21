/**
 * Lane colours of the git graph. Explicit hex rather than theme tokens, for the
 * same reason as `agents/colors.ts`: "the blue line" must stay blue whatever
 * accent the user picked. Mid-tone on purpose, so each reads on the dark and
 * on the light surface. Index 0 is the current branch's line.
 */
export const GRAPH_COLORS = [
  '#4aa8ff',
  '#3ec97f',
  '#f59e42',
  '#b07cff',
  '#ef5da8',
  '#2bc4c4',
  '#e5c23a',
  '#f0645a',
  '#8a9bb0',
] as const;

export const GRAPH_COLOR_COUNT = GRAPH_COLORS.length;

/** The hex for a palette index; indexes past the end wrap, negatives too. */
export function graphColorHex(index: number): string {
  const wrapped = ((index % GRAPH_COLOR_COUNT) + GRAPH_COLOR_COUNT) % GRAPH_COLOR_COUNT;
  return GRAPH_COLORS[wrapped];
}

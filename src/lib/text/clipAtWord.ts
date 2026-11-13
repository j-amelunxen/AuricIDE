/**
 * Cuts `text` to at most `max` characters plus an ellipsis, at the last
 * sentence or word break when one falls in the last 60 % of the cut, so a
 * summary does not end mid-word. Trailing punctuation goes before the ellipsis.
 */
export function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf(' '));
  const trimmed = lastStop > max * 0.4 ? slice.slice(0, lastStop) : slice;
  return `${trimmed.replace(/[\s,;:.-]+$/, '')}…`;
}

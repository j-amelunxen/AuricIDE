/**
 * Detects whether a string looks like an ASCII-art / box-drawing diagram.
 *
 * Heuristics (OR logic – any one is sufficient):
 *  1. Unicode box-drawing characters (U+2500–U+257F) – ≥ 2 present
 *  2. ASCII grid pattern – ≥ 2 lines each containing + / - / | and
 *     at least one `+--` / `--+` / `+-` sub-pattern across ≥ 2 lines,
 *     with at least one `+` in the whole text
 *
 * Guard: single-line text is never ASCII art.
 */
export function detectAsciiArt(text: string): boolean {
  if (!text) return false;

  const lines = text.split('\n');
  if (lines.length < 2) return false;

  // Heuristic 1: unicode box-drawing chars U+2500–U+257F
  let boxCharCount = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x2500 && cp <= 0x257f) {
      boxCharCount++;
      if (boxCharCount >= 2) return true;
    }
  }

  // Heuristic 2: ASCII grid pattern
  const gridPattern = /[+\-|]/;
  const gridLines = lines.filter((l) => gridPattern.test(l));
  if (gridLines.length >= 2 && text.includes('+')) {
    // At least one line must have a `+--` or `--+` or `+-` sub-pattern
    const junctionPattern = /\+[-]+|\+[-]|[-]+\+/;
    const hasJunction = gridLines.some((l) => junctionPattern.test(l));
    if (hasJunction) return true;
  }

  // Heuristic 3: pipe-and-dash boxes without + junctions
  // Matches |--------| style borders (no inner | dividers, which would be a table)
  const borderLineRe = /^\s*\|[-=]+\|\s*$/;
  const contentLineRe = /^\s*\|[^|]+\|\s*$/;
  const hasBorder = lines.some((l) => borderLineRe.test(l));
  const hasContent = lines.some((l) => contentLineRe.test(l));
  if (hasBorder && hasContent && lines.length >= 3) return true;

  return false;
}

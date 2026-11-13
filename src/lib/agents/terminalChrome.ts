/**
 * What in a CLI's terminal output is redraw noise rather than work: the
 * activity line and the step handoff read the same screens, so they share
 * one answer.
 */

/**
 * Hints CLIs repaint constantly. Kept short on purpose: over-filtering would
 * drop real output, and a slightly noisy line is worth more than an empty one.
 */
const CHROME_PATTERNS = [
  /^esc to interrupt/i,
  /^\? for shortcuts/i,
  /^ctrl\+[a-z] to /i,
  /^press [a-z-]+ to /i,
];

/**
 * Leading decoration CLIs prefix status lines with (⏺, ✻, ⠋, ▪, >, ·). A
 * spinner rotates that glyph, so two frames of one sentence differ only there.
 */
const LEADING_DECORATION = /^[^\p{L}\p{N}(["']+/u;

/**
 * A line worth reading has a letter. Digits alone are not enough: box drawing
 * and a bare "███ 62%" are decoration for someone watching live.
 */
const HAS_WORDS = /\p{L}/u;

export function stripLeadingDecoration(line: string): string {
  return line.replace(LEADING_DECORATION, '');
}

/** True for a trimmed, ANSI-free line that says nothing about the work. */
export function isRedrawNoise(line: string): boolean {
  if (!HAS_WORDS.test(line)) return true;
  // Tried with and without the leading glyph: "? for shortcuts" starts with one.
  const body = stripLeadingDecoration(line);
  return CHROME_PATTERNS.some((pattern) => pattern.test(line) || pattern.test(body));
}

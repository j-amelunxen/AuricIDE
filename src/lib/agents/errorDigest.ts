import { stripAnsi } from '../terminal/ansi';

/** Longest digest shown before it is elided — same budget as the activity line. */
export const ERROR_DIGEST_MAX_CHARS = 72;

/** How many trailing chunks to look at — same reasoning as in activity.ts. */
const SCANNED_CHUNKS = 24;

/** Lines that state a failure, as CLIs actually phrase them. */
const ERROR_PATTERNS: RegExp[] = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bfatal\b/i,
  /\bpanic(?:ked)?\b/i,
  /\bexception\b/i,
  /\bexit code [1-9]/i,
  /\bE[A-Z]{2,}\b/, // ENOENT, EACCES, ECONNREFUSED …
];

/** A line worth showing has at least one letter or digit in it. */
const HAS_WORDS = /[\p{L}\p{N}]/u;

/**
 * Why the agent died, in one line, distilled from the tail of its output.
 * The last error-looking line wins; failing that, the last meaningful line —
 * a process can die without printing the word "error", and the last thing it
 * said is still the best available clue. Null only when the tail says nothing.
 *
 * This is what lets a failed agent state its reason on the review row, so
 * finding out costs a glance instead of opening the terminal.
 */
export function deriveErrorDigest(chunks: string[]): string | null {
  if (chunks.length === 0) return null;

  const tail = chunks.slice(-SCANNED_CHUNKS).join('');
  const lines = tail
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => stripAnsi(line).replace(/\s+/g, ' ').trim())
    .filter((line) => HAS_WORDS.test(line));
  if (lines.length === 0) return null;

  const lastError = lines
    .slice()
    .reverse()
    .find((line) => ERROR_PATTERNS.some((pattern) => pattern.test(line)));
  const digest = lastError ?? lines[lines.length - 1];

  return digest.length > ERROR_DIGEST_MAX_CHARS
    ? `${digest.slice(0, ERROR_DIGEST_MAX_CHARS)}…`
    : digest;
}

import { stripAnsi } from '../terminal/ansi';

/**
 * How many trailing meaningful lines a prompt may sit in before it no longer
 * counts as "waiting on you". A menu the user already answered scrolls out of
 * this window as the agent's next output arrives.
 */
const SCANNED_LINES = 5;

/** How many trailing chunks to look at — same reasoning as in activity.ts. */
const SCANNED_CHUNKS = 12;

/**
 * Patterns that mean "the process stopped to ask a human something".
 * Deliberately explicit: agents narrate questions in prose all the time, so a
 * bare question mark must never count. A missed prompt still surfaces later
 * through the stall escalation; a false one would cry wolf.
 */
const PROMPT_PATTERNS: RegExp[] = [
  /\?\s*[([](?:y(?:es)?\s*\/\s*no?)[)\]]/i, // "? (y/n)", "? [Y/n]", "? (yes/no)"
  /\bdo you want to\b.*\?/i, // Claude/Codex-style permission questions
  /^❯?\s*\d+\.\s+(yes|no)\b/i, // "❯ 1. Yes" selection menus
  /\bpress enter\b/i,
  /\bwaiting for (?:your )?input\b/i,
];

/**
 * True when the tail of an agent's output looks like a prompt waiting for a
 * human. This must not lean on silence: permission menus redraw themselves,
 * which keeps `lastActivityAt` fresh and makes a blocked agent look busy —
 * the one state the panel most needs to catch.
 */
export function detectAwaitingInput(chunks: string[]): boolean {
  if (chunks.length === 0) return false;

  const tail = chunks.slice(-SCANNED_CHUNKS).join('');
  const lines = tail
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => stripAnsi(line).replace(/\s+/g, ' ').trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line));

  return lines
    .slice(-SCANNED_LINES)
    .some((line) => PROMPT_PATTERNS.some((pattern) => pattern.test(line)));
}

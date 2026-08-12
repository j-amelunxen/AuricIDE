import { stripAnsi } from '../terminal/ansi';

/**
 * How much of the previous session travels to the next step. Wide enough for
 * the last few exchanges, narrow enough that the step's own instruction still
 * leads — and that the whole thing stays a sane command-line argument.
 */
export const HANDOFF_MAX_CHARS = 2000;

/**
 * How many trailing chunks to scan. Far more than the activity line needs:
 * this wants the last stretch of the conversation, not the newest sentence.
 */
const SCANNED_CHUNKS = 400;

/**
 * Interface chrome that redraws constantly and says nothing about the work.
 * Kept short on purpose — over-filtering would drop real output, and a
 * slightly noisy handoff is worth more than a confidently emptied one.
 */
const CHROME_PATTERNS = [
  /^esc to interrupt/i,
  /^\? for shortcuts/i,
  /^ctrl\+[a-z] to /i,
  /^press [a-z-]+ to /i,
];

/**
 * A line worth carrying has at least one letter. Digits alone are not enough:
 * box drawing and a bare "███ 62%" are decoration for a human watching live,
 * and to the next session they are budget spent on nothing.
 */
const HAS_WORDS = /\p{L}/u;

/**
 * Leading decoration CLIs prefix status lines with (⏺, ✻, ⠋, ▪, >, ·). A
 * spinner rotates that glyph, so two frames of the same sentence are never
 * byte-identical — repetition has to be judged on what follows it.
 */
const LEADING_DECORATION = /^[^\p{L}\p{N}(["']+/u;

/**
 * What the previous session left on screen, cleaned up enough to paste into
 * the next one's instruction. Null when the tail holds nothing but redraw
 * noise.
 *
 * This is deliberately provider-agnostic: it reads the raw stdout every
 * harness produces and never looks for a Claude/Codex/Grok-shaped format, so
 * a chain that switches CLI between steps hands over the same way. The price
 * is that it is a *tail*, not a summary — which is why `composeStepTask` says
 * so out loud to whoever receives it.
 */
export function deriveHandoffContext(chunks: string[]): string | null {
  if (chunks.length === 0) return null;

  const tail = chunks.slice(-SCANNED_CHUNKS).join('');
  const lines = tail.replace(/\r\n?/g, '\n').split('\n');

  const cleaned: string[] = [];
  let previousBody = '';
  for (const raw of lines) {
    const line = stripAnsi(raw).replace(/\s+$/, '');
    const compact = line.trim();

    if (!compact) {
      // Keep paragraph breaks, drop the runs of them a redraw leaves behind.
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') cleaned.push('');
      previousBody = '';
      continue;
    }
    if (!HAS_WORDS.test(compact)) continue;
    if (CHROME_PATTERNS.some((pattern) => pattern.test(compact))) continue;

    // A spinner repaints the same line many times a second, rotating only its
    // frame glyph — so repetition is judged on the text after the decoration.
    const body = compact.replace(LEADING_DECORATION, '');
    if (body === previousBody) continue;
    previousBody = body;

    cleaned.push(line);
  }

  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') cleaned.pop();
  if (cleaned.length === 0) return null;

  // Spend the budget from the newest line backwards, and stop at a line
  // boundary — a handoff that opens mid-word reads as corruption.
  const kept: string[] = [];
  let budget = HANDOFF_MAX_CHARS;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const cost = cleaned[i].length + (kept.length > 0 ? 1 : 0);
    if (cost > budget) break;
    budget -= cost;
    kept.unshift(cleaned[i]);
  }

  if (kept.length === 0) {
    // One line longer than the whole budget: its end is the recent part.
    const last = cleaned[cleaned.length - 1];
    return `…${last.slice(-(HANDOFF_MAX_CHARS - 1))}`;
  }

  while (kept.length > 0 && kept[0] === '') kept.shift();
  if (kept.length === 0) return null;

  return kept.join('\n');
}

/**
 * The instruction the next step actually receives: its own prompt, plus what
 * the step before it left behind.
 *
 * The prompt stays first because every CLI reads a leading `/` as a command —
 * context pushed in front of it would turn the invocation into prose. And the
 * block is labelled for what it is: a truncated terminal tail, so the session
 * treats it as a lead rather than as a record it can trust.
 */
export function composeStepTask(
  prompt: string,
  context: string | null,
  previousStepLabel: string
): string {
  if (!context) return prompt;

  const from = previousStepLabel.trim() ? `“${previousStepLabel.trim()}”` : 'the previous step';
  return [
    prompt,
    '',
    `Context from ${from}, the step before this one in the same chain. It is the`,
    'raw tail of that session’s terminal output — not a summary, possibly cut off,',
    'and it may contain interface noise. Use it to pick up where that step left',
    'off, and check the working tree before relying on any detail in it.',
    '',
    '--- previous step output (tail) ---',
    context,
    '--- end previous step output ---',
  ].join('\n');
}

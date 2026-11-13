import { stripAnsi } from '../terminal/ansi';
import { isRedrawNoise, stripLeadingDecoration } from './terminalChrome';

/** Longest activity line shown before it is elided. */
export const ACTIVITY_MAX_CHARS = 72;

/**
 * How many trailing log chunks to look at. A retained buffer can hold
 * thousands of chunks; the newest line is always within the last few, and the
 * derivation runs for every agent on every activity tick.
 */
const SCANNED_CHUNKS = 12;

/**
 * The newest line of an agent's output that actually says something, cleaned
 * up for a one-line display. Returns null when the tail holds only blank
 * lines, box-drawing and other redraw noise.
 *
 * This is what an agent is *doing right now*, as opposed to `currentTask`,
 * which is the instruction it was started with and never changes.
 */
export function deriveAgentActivity(chunks: string[]): string | null {
  if (chunks.length === 0) return null;

  const tail = chunks.slice(-SCANNED_CHUNKS).join('');
  // \r moves the cursor back to column 0, so progress output overwrites in
  // place — for a plain-text tail that is a line break like any other.
  const lines = tail.replace(/\r\n?/g, '\n').split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const shown = stripAnsi(lines[i]).replace(/\s+/g, ' ').trim();
    if (!shown || isRedrawNoise(shown)) continue;
    const line = stripLeadingDecoration(shown).trim();

    return line.length > ACTIVITY_MAX_CHARS ? `${line.slice(0, ACTIVITY_MAX_CHARS)}…` : line;
  }

  return null;
}

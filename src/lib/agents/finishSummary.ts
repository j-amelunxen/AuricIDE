import { deriveHandoffContext } from './handoff';

/**
 * Longest body the inbox row will carry. The tray clamps to two lines, so
 * anything past this is budget spent on text nobody reads there; the OS
 * banner gets the same string and is even shorter.
 */
export const FINISH_SUMMARY_MAX_CHARS = 240;

/** Claude-style `Read(path)` / `Bash(cmd)` lines, decoration included. */
const TOOL_CALL_LINE =
  /^(?:[^\p{L}\p{N}(["']+\s*)?(Read|Write|Update|Edit|Create|Bash|Glob|Grep|Search|Task|WebFetch)\([^)]*\)\s*$/u;

/** A spinner or status verb with nothing else on the line. */
const STATUS_LINE = /^(thinking|working|running|loading|compiling|waiting)[.…]*$/i;

export function clipFinishSummary(text: string): string {
  if (text.length <= FINISH_SUMMARY_MAX_CHARS) return text;
  const slice = text.slice(0, FINISH_SUMMARY_MAX_CHARS);
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf(' '));
  const trimmed = lastStop > FINISH_SUMMARY_MAX_CHARS * 0.4 ? slice.slice(0, lastStop) : slice;
  return `${trimmed.replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * What a finished headless agent left behind, short enough to put on an
 * inbox row. The agent's own last words — a headless CLI prints its result
 * and exits, so the tail *is* the summary. Null only when the tail says
 * nothing; the title still tells you it finished.
 */
export function deriveFinishSummary(chunks: string[]): string | null {
  const tail = deriveHandoffContext(chunks);
  if (!tail) return null;

  const lines = tail
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !TOOL_CALL_LINE.test(line))
    .filter((line) => !STATUS_LINE.test(line));

  const source = lines.length > 0 ? lines.slice(-3).join(' ') : tail.replace(/\s+/g, ' ').trim();
  if (!source) return null;
  return clipFinishSummary(source);
}

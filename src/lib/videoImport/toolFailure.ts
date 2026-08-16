/**
 * One rule: what the user reads first is a sentence.
 *
 * The Rust side classifies tool output and sends `{summary, details, logPath}`
 * as JSON. Not everything that reaches the UI comes from there, though — a
 * dropped IPC call, a thrown `Error`, a plain string from an older path — so
 * this is also the place that keeps an unclassified traceback from being
 * rendered as the headline. It demotes it to detail instead of discarding it.
 */

export interface ToolFailure {
  /** A single line, safe to render as the error message. */
  summary: string;
  /** Everything else, for a fold. Empty when there is nothing more to say. */
  details: string;
  /** Full, untrimmed output on disk, when the backend wrote one. */
  logPath: string | null;
}

const MAX_SUMMARY_CHARS = 200;
const FALLBACK = 'Something went wrong, and no reason was reported.';

/** Output that must never headline an error box, whatever else is true of it. */
function looksLikeToolOutput(line: string): boolean {
  return (
    line.startsWith('Traceback') ||
    line.startsWith('  File "') ||
    /^\s*at\s/.test(line) ||
    /^[A-Za-z_]+(Error|Exception):/.test(line)
  );
}

function fromText(raw: string): ToolFailure {
  const lines = raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { summary: FALLBACK, details: '', logPath: null };

  // A single short line is already a message; anything longer or shaped like a
  // traceback becomes detail, and the headline says so plainly.
  const [first, ...rest] = lines;
  if (lines.length === 1 && first.length <= MAX_SUMMARY_CHARS && !looksLikeToolOutput(first)) {
    return { summary: first, details: '', logPath: null };
  }
  if (looksLikeToolOutput(first) || first.length > MAX_SUMMARY_CHARS) {
    return { summary: FALLBACK, details: lines.join('\n'), logPath: null };
  }
  return { summary: first, details: rest.join('\n'), logPath: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseToolFailure(reason: unknown): ToolFailure {
  if (reason instanceof Error) return fromText(reason.message);
  if (isRecord(reason) && typeof reason.summary === 'string') {
    return {
      summary: reason.summary,
      details: typeof reason.details === 'string' ? reason.details : '',
      logPath: typeof reason.logPath === 'string' ? reason.logPath : null,
    };
  }
  if (typeof reason !== 'string') {
    return reason === null || reason === undefined
      ? { summary: FALLBACK, details: '', logPath: null }
      : fromText(String(reason));
  }

  const trimmed = reason.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      // Only a payload that actually carries a summary is a structured
      // failure. Other JSON is machine output like any other — readable
      // enough as detail, never as the sentence someone is asked to act on.
      if (isRecord(parsed)) {
        return typeof parsed.summary === 'string'
          ? parseToolFailure(parsed)
          : { summary: FALLBACK, details: trimmed, logPath: null };
      }
    } catch {
      // Not JSON after all; fall through and treat it as text.
    }
  }
  return fromText(reason);
}

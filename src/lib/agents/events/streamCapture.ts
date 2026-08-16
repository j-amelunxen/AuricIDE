import { stripAnsi } from '../../terminal/ansi';
import { createLineBuffer } from './lineBuffer';

/** One readable line of an agent's output, ready to interleave with others'. */
export interface StreamLine {
  text: string;
  at: number;
  /**
   * Monotonic per agent. One PTY chunk commonly yields several lines stamped
   * with the same `at`; without this a newest-first merge would show them in
   * reverse.
   */
  seq: number;
}

/**
 * How many trailing lines one agent's readable stream keeps. Sized to hold a
 * few minutes of a talkative agent — far past what anyone scrolls back
 * through live, and small enough that a whole fleet's worth stays cheap.
 */
export const MAX_STREAM_LINES = 1_500;

/**
 * A line worth showing has at least one letter or digit in it.
 *
 * Agent TUIs spend most of their output redrawing frames: box borders,
 * spinner glyphs, rules, padding. Those carry no information once the text is
 * lifted out of its layout, and at a fleet's volume they would bury the lines
 * that do. This is the one place that judgement is made.
 */
export function isReadableLine(line: string): boolean {
  return /[\p{L}\p{N}]/u.test(line);
}

export interface StreamCapture {
  /** Feeds one PTY chunk in and returns the readable lines it completed. */
  push(chunk: string, at: number): StreamLine[];
}

/**
 * Turns one agent's raw PTY output into readable lines, one capture per agent.
 *
 * Deliberately separate from the event extractor: that one answers "what did
 * this agent *do*" and keeps only what a matcher recognised, which is why the
 * feed built on it looks sparse. This one answers "what did this agent
 * *say*", and drops only redraw chrome and immediate repeats.
 */
export function createStreamCapture(): StreamCapture {
  const lineBuffer = createLineBuffer();
  let seq = 0;
  let previous: string | null = null;

  return {
    push(chunk: string, at: number): StreamLine[] {
      const lines: StreamLine[] = [];
      for (const raw of lineBuffer.take(chunk)) {
        const text = stripAnsi(raw).trimEnd();
        if (!isReadableLine(text)) continue;
        // A spinner or status line redraws itself unchanged many times a
        // second. Collapsing consecutive repeats keeps the stream readable
        // without hiding a line that genuinely recurs later.
        if (text === previous) continue;
        previous = text;
        lines.push({ text, at, seq: seq++ });
      }
      return lines;
    },
  };
}

/** Appends new lines to an agent's stream, dropping the oldest past the cap. */
export function appendStreamLines(existing: StreamLine[], incoming: StreamLine[]): StreamLine[] {
  if (incoming.length === 0) return existing;
  return [...existing, ...incoming].slice(-MAX_STREAM_LINES);
}

import { stripAnsi } from '../../terminal/ansi';
import { createLineBuffer } from './lineBuffer';
import { resolveMatcher } from './providers';
import type { AgentEvent, AgentEventKind } from './types';

export { MAX_PARTIAL_LINE_BYTES } from './lineBuffer';

export interface EventExtractor {
  /** Feeds one PTY chunk in and returns the events it produced, if any. */
  push(chunk: string, at: number): AgentEvent[];
}

/**
 * How many of the most recent matched (kind|label) pairs the "chatty" kinds
 * are checked against for a repeat — see `RING_DEDUPE_KINDS`.
 */
const DEDUPE_RING_SIZE = 5;

/**
 * Kinds whose redraws are known to interleave with something else and so
 * are never *literally* adjacent to their own repeat: a permission menu
 * commonly prints more than one option line per redraw (e.g. "1. Yes" then
 * "2. No"), and a free-text note can redraw around other chrome lines.
 * Widening the dedupe window to these kinds only keeps read/edit/run intact
 * for the common case that matters more — a real second edit of the same
 * file a few lines later must still show up, not silently vanish because it
 * happened to land within the window.
 */
const RING_DEDUPE_KINDS: ReadonlySet<AgentEventKind> = new Set(['ask', 'note']);

/** A small fixed-capacity, most-recently-used memory of matched (kind|label)
 * keys — the redraw-dedupe window. */
function createDedupeRing(capacity: number) {
  const seen: string[] = [];
  return {
    /** Records `key` as freshly seen, evicting the oldest entry over capacity. */
    remember(key: string): void {
      const index = seen.indexOf(key);
      if (index !== -1) seen.splice(index, 1);
      seen.push(key);
      if (seen.length > capacity) seen.shift();
    },
    /**
     * True when `key` counts as a repeat for `kind` — anywhere in the ring
     * for the chatty kinds, or only the single most recent entry otherwise.
     */
    isRepeat(key: string, kind: AgentEventKind): boolean {
      return RING_DEDUPE_KINDS.has(kind) ? seen.includes(key) : seen[seen.length - 1] === key;
    },
  };
}

/**
 * Turns an agent's raw PTY output into structured events, one extractor per
 * agent. Stateful on purpose: PTY chunks split lines arbitrarily, so a line
 * half-delivered in one chunk is held until the rest arrives in the next —
 * this must never rescan the whole log, only the newest chunk.
 */
export function createEventExtractor(providerId: string): EventExtractor {
  const matchLine = resolveMatcher(providerId);
  const lineBuffer = createLineBuffer();
  let seq = 0;
  const dedupeRing = createDedupeRing(DEDUPE_RING_SIZE);

  function processLine(line: string, at: number): AgentEvent | null {
    const matched = matchLine(stripAnsi(line));
    if (!matched) return null;

    const key = `${matched.kind}|${matched.label}`;
    const isRepeat = dedupeRing.isRepeat(key, matched.kind);
    dedupeRing.remember(key);
    if (isRepeat) return null;

    return { ...matched, at, seq: seq++ };
  }

  return {
    push(chunk: string, at: number): AgentEvent[] {
      const events: AgentEvent[] = [];
      for (const line of lineBuffer.take(chunk)) {
        const event = processLine(line, at);
        if (event) events.push(event);
      }
      return events;
    },
  };
}

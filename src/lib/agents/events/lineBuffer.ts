/**
 * Upper bound on the unterminated-partial-line buffer. Ordinary output
 * completes a line within a chunk or two, but a stream that never emits a
 * newline (a stuck progress bar, a binary blob accidentally sent to stdout)
 * would otherwise grow this buffer for as long as the agent runs. Capped by
 * dropping from the front — the newest tail is what a line, once it finally
 * completes, actually needs.
 */
export const MAX_PARTIAL_LINE_BYTES = 64 * 1024;

export interface LineBuffer {
  /**
   * Feeds one PTY chunk in and returns the lines it completed. A line only
   * half-delivered in this chunk is held until the rest arrives.
   */
  take(chunk: string): string[];
}

/**
 * Turns a stream of arbitrarily-split PTY chunks into whole lines.
 *
 * Stateful on purpose, and shared by everything that reads an agent's output
 * line by line — the event extractor and the raw stream capture both need
 * exactly this and must never disagree about where a line ends.
 */
export function createLineBuffer(maxPartialBytes = MAX_PARTIAL_LINE_BYTES): LineBuffer {
  let buffer = '';

  return {
    take(chunk: string): string[] {
      // \r moves the cursor back to column 0 — for line-oriented parsing
      // that is a line break like any other (see activity.ts).
      buffer += chunk.replace(/\r\n?/g, '\n');
      const lines = buffer.split('\n');
      // The last element is whatever comes after the final newline so far —
      // possibly a complete line whose terminator just hasn't arrived yet.
      buffer = lines.pop() ?? '';
      if (buffer.length > maxPartialBytes) {
        buffer = buffer.slice(-maxPartialBytes);
      }
      return lines;
    },
  };
}

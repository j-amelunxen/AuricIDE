interface ViewportLine {
  translateToString(trimRight?: boolean): string;
}

/** The slice of an xterm buffer that is actually on screen. */
export interface ViewportTerminal {
  rows: number;
  buffer: {
    active: {
      viewportY: number;
      getLine(index: number): ViewportLine | undefined;
    };
  };
}

/**
 * The rows on screen right now. Scrollback stays in the terminal: a scratch
 * made from it would be a log, not the screen the user is looking at.
 * Blank rows at the edges are dropped so the file is not padded with the
 * empty part of the viewport.
 */
export function visibleTerminalText(term: ViewportTerminal): string {
  // getLine reads the buffer through `this`. Pulling it off the object and
  // calling it bare throws inside xterm (`_buffer` is missing).
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < term.rows; row += 1) {
    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
  }
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].length === 0) start += 1;
  while (end > start && lines[end - 1].length === 0) end -= 1;
  return lines.slice(start, end).join('\n');
}

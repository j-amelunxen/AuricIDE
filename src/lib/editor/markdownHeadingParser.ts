export interface HeadingRange {
  level: number;
  from: number;
  to: number;
  title: string;
  lineNumber: number;
}

/**
 * Build a set of character ranges that are inside fenced code blocks.
 * Returns an array of [from, to] pairs (character offsets).
 */
function buildCodeFenceMask(text: string): [number, number][] {
  const mask: [number, number][] = [];
  const lines = text.split('\n');
  let offset = 0;
  let inFence = false;
  let fenceStart = 0;

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceStart = offset;
      } else {
        mask.push([fenceStart, offset + line.length]);
        inFence = false;
      }
    }
    offset += line.length + 1; // +1 for newline
  }

  // Unclosed fence extends to EOF
  if (inFence) {
    mask.push([fenceStart, text.length]);
  }

  return mask;
}

function isInsideCodeFence(offset: number, mask: [number, number][]): boolean {
  return mask.some(([from, to]) => offset >= from && offset <= to);
}

/**
 * Extract ATX-style headings (#-######) from markdown text.
 * Skips headings inside fenced code blocks.
 */
export function extractHeadings(text: string): HeadingRange[] {
  if (!text) return [];

  const codeFenceMask = buildCodeFenceMask(text);
  const headings: { level: number; from: number; title: string; lineNumber: number }[] = [];

  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^(#{1,6})\s+(.*)$/.exec(line);

    if (match && !isInsideCodeFence(offset, codeFenceMask)) {
      headings.push({
        level: match[1].length,
        from: offset,
        title: match[2].trim(),
        lineNumber: i + 1,
      });
    }

    offset += line.length + 1; // +1 for newline
  }

  // Compute `to` for each heading: extends to just before the next heading
  // of any level, or EOF
  const result: HeadingRange[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];
    const to = nextHeading ? nextHeading.from - 1 : text.length;

    result.push({
      level: heading.level,
      from: heading.from,
      to,
      title: heading.title,
      lineNumber: heading.lineNumber,
    });
  }

  return result;
}

/**
 * Build the hierarchical heading breadcrumb path for the given cursor line.
 * Returns the chain of headings (e.g. [H1, H2, H3]) the cursor is currently inside.
 */
export function getHeadingBreadcrumbs(
  headings: HeadingRange[],
  cursorLine: number
): HeadingRange[] {
  const stack: HeadingRange[] = [];

  for (const heading of headings) {
    if (heading.lineNumber > cursorLine) break;

    // Pop headings with level >= current to maintain hierarchy
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }

  return stack;
}

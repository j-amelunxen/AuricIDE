export interface MermaidBlock {
  code: string;
  from: number;
  to: number;
}

/**
 * Extract ```mermaid ... ``` code blocks from markdown text.
 * Returns an array of MermaidBlock with the code content and
 * character offsets (from/to) in the original source.
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const pattern = /^```mermaid\s*$/gim;

  let openMatch: RegExpExecArray | null;
  while ((openMatch = pattern.exec(markdown)) !== null) {
    // Verify the match is exactly "mermaid" (not "mermaidx" etc.)
    // The regex uses \s*$ so it only matches if the line ends after "mermaid" + optional whitespace.
    // But we also need to ensure nothing else follows "mermaid" on the same line before whitespace.
    const matchedLine = openMatch[0];
    const langPart = matchedLine.replace(/^```/, '').trim();
    if (langPart.toLowerCase() !== 'mermaid') {
      continue;
    }

    const contentStart = openMatch.index + openMatch[0].length + 1; // +1 for the newline
    const closingIndex = markdown.indexOf('\n```', contentStart - 1);

    let code: string;
    let blockEnd: number;

    if (closingIndex === -1) {
      // No closing fence found -- treat rest of document as the block
      code = markdown.slice(contentStart);
      blockEnd = markdown.length;
    } else {
      const codeEnd = closingIndex === contentStart - 1 ? contentStart - 1 : closingIndex;
      code = markdown.slice(contentStart, codeEnd);
      blockEnd = closingIndex + 4; // \n + ``` = 4 chars
    }

    blocks.push({
      code,
      from: openMatch.index,
      to: blockEnd,
    });

    // Advance the pattern past this block
    pattern.lastIndex = blockEnd;
  }

  return blocks;
}

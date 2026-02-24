import { extractMermaidBlocks } from '@/lib/editor/mermaidBlocks';

/**
 * Replace the content of a mermaid block in a markdown string.
 *
 * Finds the block whose trimmed code matches `oldCode.trim()`,
 * then replaces the entire fenced block (from/to) with a new
 * fenced block containing `newCode`.
 *
 * Returns the original markdown unchanged if no matching block is found.
 */
export function replaceMermaidBlock(markdown: string, oldCode: string, newCode: string): string {
  const blocks = extractMermaidBlocks(markdown);
  const target = blocks.find((b) => b.code.trim() === oldCode.trim());

  if (!target) {
    return markdown;
  }

  const reconstructed = `\`\`\`mermaid\n${newCode}\n\`\`\``;
  return markdown.slice(0, target.from) + reconstructed + markdown.slice(target.to);
}

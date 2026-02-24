export interface HeadingRenameChange {
  filePath: string;
  from: number;
  to: number;
  oldText: string;
  newText: string;
}

/**
 * Apply rename changes to a single file's content.
 * Changes are applied in reverse offset order to preserve positions.
 */
export function applyChangesToContent(content: string, changes: HeadingRenameChange[]): string {
  if (changes.length === 0) return content;

  // Sort by `from` descending so we can apply from end to start
  const sorted = [...changes].sort((a, b) => b.from - a.from);

  let result = content;
  for (const change of sorted) {
    result = result.slice(0, change.from) + change.newText + result.slice(change.to);
  }

  return result;
}

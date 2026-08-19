/**
 * Attachments collected in the spawn dialog. CLI agents pick file paths out of
 * the start prompt the same way they pick a path dropped into the terminal.
 */

export function composeTaskWithAttachments(instruction: string, paths: string[]): string {
  const trimmed = instruction.trim();
  if (paths.length === 0) return trimmed;
  const block = paths.join('\n');
  return trimmed.length > 0 ? `${trimmed}\n\n${block}` : block;
}

export function mergeAttachmentPaths(current: string[], incoming: string[]): string[] {
  const next = [...current];
  const seen = new Set(current);
  for (const path of incoming) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    next.push(path);
  }
  return next;
}

export function spawnAttachmentLabel(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

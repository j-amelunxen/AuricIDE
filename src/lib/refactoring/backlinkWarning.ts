const MAX_NAMES_SHOWN = 5;

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Warns about files that still link to what's about to be deleted, so a
 * delete doesn't silently leave dangling [[wiki-links]] behind. Returns
 * null when nothing outside the batch being deleted references any of it.
 */
export function computeBacklinkWarning(
  paths: string[],
  getBacklinksFor: (targetFileName: string) => string[]
): string | null {
  const deletedBasenames = new Set(paths.map((p) => basename(p).toLowerCase()).filter(Boolean));
  const referencedBy = new Set<string>();

  for (const path of paths) {
    const name = basename(path);
    if (!name) continue;
    for (const ref of getBacklinksFor(name)) {
      if (!deletedBasenames.has(basename(ref).toLowerCase())) {
        referencedBy.add(ref);
      }
    }
  }

  if (referencedBy.size === 0) return null;

  const names = Array.from(referencedBy).map(basename).sort();
  const shown = names.slice(0, MAX_NAMES_SHOWN).join(', ');
  const rest = names.length > MAX_NAMES_SHOWN ? ` and ${names.length - MAX_NAMES_SHOWN} more` : '';
  return `Referenced by ${names.length} file${names.length === 1 ? '' : 's'}: ${shown}${rest}.`;
}

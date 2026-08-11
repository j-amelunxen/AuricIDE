const SCRATCH_NAME = /^scratch-(\d+)\.md$/;

function scratchNumber(name: string): number | null {
  const match = SCRATCH_NAME.exec(name);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Next auto-generated scratch name: max existing number + 1. Deliberately not
 * gap-filling — reusing a just-deleted name would collide with stale
 * autosave/diagnostics entries still keyed by the old path.
 */
export function nextScratchName(existing: string[]): string {
  const max = existing.reduce((acc, name) => Math.max(acc, scratchNumber(name) ?? 0), 0);
  return `scratch-${max + 1}.md`;
}

/** Numbered scratches first, newest (highest number) on top; renamed ones after, alphabetical. */
export function compareScratchNames(a: string, b: string): number {
  const na = scratchNumber(a);
  const nb = scratchNumber(b);
  if (na !== null && nb !== null) return nb - na;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b);
}

export function isScratchPath(path: string, scratchDir: string | null): boolean {
  if (!scratchDir) return false;
  const prefix = scratchDir.endsWith('/') ? scratchDir : `${scratchDir}/`;
  return path.startsWith(prefix);
}

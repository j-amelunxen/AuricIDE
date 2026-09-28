/**
 * "Does the project file index know this path?" — for a file, whether it is
 * listed; for a folder, whether any listed file lies beneath it.
 *
 * Built once per file list (the store keeps the array's identity until the
 * list really changes), so asking per watcher event stays a set lookup.
 */
const cache = new WeakMap<readonly string[], (path: string) => boolean>();

export function indexedPathLookup(paths: readonly string[]): (path: string) => boolean {
  const cached = cache.get(paths);
  if (cached) return cached;
  const known = new Set<string>();
  for (const path of paths) {
    known.add(path);
    for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
      const dir = path.slice(0, cut);
      if (known.has(dir)) break;
      known.add(dir);
    }
  }
  const lookup = (path: string) => known.has(path);
  cache.set(paths, lookup);
  return lookup;
}

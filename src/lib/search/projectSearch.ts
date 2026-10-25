import { fuzzyMatch } from '@/lib/commands/fuzzy';

interface ProjectMatch<T> {
  item: T;
  score: number;
  /** Name offsets to highlight. Empty when only the path matched. */
  nameIndices: number[];
}

/** A path hit is a fallback, never a reason to outrank a name hit (as categories in the palette). */
const PATH_PENALTY = 60;

/**
 * Filters and orders projects by a typed query, the way the command palette ranks commands:
 * the name first (prefix and word starts over contiguous runs over scattered letters), the
 * path as a weaker fallback. Spaces in the query are ignored, so "api gate" finds
 * "api-gateway". An empty query keeps the given order.
 */
export function rankProjects<T extends { name: string; path: string }>(
  items: readonly T[],
  query: string
): ProjectMatch<T>[] {
  const needle = query.replace(/\s+/g, '');
  if (needle === '') return items.map((item) => ({ item, score: 0, nameIndices: [] }));

  const ranked: (ProjectMatch<T> & { order: number })[] = [];
  items.forEach((item, order) => {
    const byName = fuzzyMatch(item.name, needle);
    if (byName) {
      ranked.push({ item, score: byName.score, nameIndices: byName.indices, order });
      return;
    }
    const byPath = fuzzyMatch(item.path, needle);
    if (byPath) ranked.push({ item, score: byPath.score - PATH_PENALTY, nameIndices: [], order });
  });

  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.map(({ item, score, nameIndices }) => ({ item, score, nameIndices }));
}

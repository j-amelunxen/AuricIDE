import type { Command } from './registry';

/** A successful fuzzy match: a score for ranking plus the matched character offsets. */
export interface FuzzyMatch {
  score: number;
  /** Offsets into the searched text, ascending — one per query character. */
  indices: number[];
}

export interface RankedCommand {
  command: Command;
  score: number;
  /** Label offsets to highlight. Empty when only the category matched. */
  indices: number[];
}

const MATCH = 16;
const CONSECUTIVE = 14;
const BONUS_START = 20;
/** As strong as a string start: typing initials ("ogo") should find the acronym. */
const BONUS_WORD = 20;
const BONUS_CAMEL = 12;
/** Charged per skipped character so tight matches beat sprawling ones. */
const GAP_PENALTY = 0.5;
/** Slight nudge towards shorter labels when scores are otherwise equal. */
const LENGTH_PENALTY = 0.05;
/** Category matches are a fallback, never a reason to outrank a label hit. */
const CATEGORY_PENALTY = 60;
/** Big enough to break ties, too small to beat a genuinely better match. */
const RECENCY_BONUS = 6;

const SEPARATORS = new Set([' ', '-', '_', '.', '/', ':', '&', '+', '(']);

function charBonus(text: string, index: number): number {
  if (index === 0) return BONUS_START;
  const prev = text[index - 1];
  if (SEPARATORS.has(prev)) return BONUS_WORD;
  const curr = text[index];
  if (prev === prev.toLowerCase() && curr !== curr.toLowerCase()) return BONUS_CAMEL;
  return 0;
}

/**
 * Scores `query` as a subsequence of `text`, the way an IDE palette does: prefixes,
 * word boundaries and runs of consecutive characters win over scattered hits.
 *
 * Returns `null` when the query is not a subsequence at all.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (query === '') return { score: 0, indices: [] };
  if (query.length > text.length) return null;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const n = text.length;
  const m = query.length;

  // dp[i][j] = best score for query[0..i] with query[i] landing on text[j].
  const dp: number[][] = [];
  const parent: number[][] = [];

  for (let i = 0; i < m; i++) {
    dp.push(new Array<number>(n).fill(Number.NEGATIVE_INFINITY));
    parent.push(new Array<number>(n).fill(-1));

    // Running max of dp[i - 1][k] + GAP_PENALTY * k, which is independent of j —
    // that is what lets the gap penalty stay linear instead of quadratic.
    let bestPrev = Number.NEGATIVE_INFINITY;
    let bestPrevIndex = -1;

    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0) {
        const candidate = dp[i - 1][j - 1];
        if (candidate > Number.NEGATIVE_INFINITY) {
          const adjusted = candidate + GAP_PENALTY * (j - 1);
          if (adjusted > bestPrev) {
            bestPrev = adjusted;
            bestPrevIndex = j - 1;
          }
        }
      }

      if (lowerText[j] !== lowerQuery[i]) continue;

      const bonus = MATCH + charBonus(text, j);

      if (i === 0) {
        dp[i][j] = bonus - GAP_PENALTY * j;
        continue;
      }

      let best = Number.NEGATIVE_INFINITY;
      let bestFrom = -1;

      if (bestPrevIndex >= 0) {
        best = bestPrev - GAP_PENALTY * j + GAP_PENALTY + bonus;
        bestFrom = bestPrevIndex;
      }

      const consecutive = j > 0 ? dp[i - 1][j - 1] : Number.NEGATIVE_INFINITY;
      if (consecutive > Number.NEGATIVE_INFINITY) {
        const score = consecutive + CONSECUTIVE + bonus;
        if (score > best) {
          best = score;
          bestFrom = j - 1;
        }
      }

      dp[i][j] = best;
      parent[i][j] = bestFrom;
    }
  }

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestEnd = -1;
  for (let j = 0; j < n; j++) {
    if (dp[m - 1][j] > bestScore) {
      bestScore = dp[m - 1][j];
      bestEnd = j;
    }
  }

  if (bestEnd < 0 || bestScore === Number.NEGATIVE_INFINITY) return null;

  const indices: number[] = [];
  let j = bestEnd;
  for (let i = m - 1; i >= 0; i--) {
    indices.unshift(j);
    j = parent[i][j];
  }

  return { score: bestScore - text.length * LENGTH_PENALTY, indices };
}

/**
 * Filters and orders commands for the palette. An empty query keeps registration
 * order with recently used commands lifted to the top; a query ranks by fuzzy score,
 * falling back to the category when the label does not match.
 */
export function rankCommands(
  commands: Command[],
  query: string,
  recentIds: readonly string[] = []
): RankedCommand[] {
  const recencyRank = new Map<string, number>();
  recentIds.forEach((id, index) => {
    if (!recencyRank.has(id)) recencyRank.set(id, index);
  });

  if (query === '') {
    const recent: Command[] = [];
    const rest: Command[] = [];
    for (const command of commands) {
      if (recencyRank.has(command.id)) recent.push(command);
      else rest.push(command);
    }
    recent.sort((a, b) => recencyRank.get(a.id)! - recencyRank.get(b.id)!);
    return [...recent, ...rest].map((command) => ({ command, score: 0, indices: [] }));
  }

  const ranked: (RankedCommand & { order: number })[] = [];

  commands.forEach((command, order) => {
    const labelMatch = fuzzyMatch(command.label, query);
    const match = labelMatch ?? fuzzyMatch(command.category, query);
    if (!match) return;

    const recencyIndex = recencyRank.get(command.id);
    const recencyBonus = recencyIndex === undefined ? 0 : RECENCY_BONUS / (recencyIndex + 1);

    ranked.push({
      command,
      score: match.score - (labelMatch ? 0 : CATEGORY_PENALTY) + recencyBonus,
      indices: labelMatch ? match.indices : [],
      order,
    });
  });

  ranked.sort((a, b) => b.score - a.score || a.order - b.order);

  return ranked.map(({ command, score, indices }) => ({ command, score, indices }));
}

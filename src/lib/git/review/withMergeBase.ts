import type { ReviewSource } from './reviewSession';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pins a ref session to the commit where the work tree's HEAD left `ref`, so
 * a review of an agent's branch shows what the agent did and not, reversed,
 * what landed on `ref` in the meantime. When git finds no merge base, the
 * session keeps the tip and carries the reason, so the header can say so.
 */
export async function withMergeBase(
  source: ReviewSource,
  getMergeBase: (repoPath: string, a: string, b: string) => Promise<string>
): Promise<ReviewSource> {
  if (source.kind !== 'ref') return source;
  try {
    const oid = await getMergeBase(source.repoPath, source.ref, 'HEAD');
    return { ...source, base: { kind: 'merge-base', oid } };
  } catch (error) {
    return { ...source, base: { kind: 'tip', reason: errorMessage(error) } };
  }
}

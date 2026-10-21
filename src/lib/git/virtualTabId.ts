import { isDiffTabId } from './diffTabId';
import { isGraphTabId } from './graphTabId';
import { isMergeTabId } from './mergeTabId';
import { isReviewTabId } from './review/reviewSession';

/**
 * A tab whose id names a view, not a file: a diff, a merge, a review, the graph. Such an
 * id must never be read, saved, blamed or resolved to a repository as a path.
 */
export function isVirtualTabId(id: string): boolean {
  return isDiffTabId(id) || isMergeTabId(id) || isGraphTabId(id) || isReviewTabId(id);
}

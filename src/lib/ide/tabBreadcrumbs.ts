import { isDiffTabId } from '@/lib/git/diffTabId';
import { isMergeTabId } from '@/lib/git/mergeTabId';
import { isReviewTabId } from '@/lib/git/review/reviewSession';
import type { Tab } from '@/lib/store/tabsSlice';

const ROOT = 'AuricIDE';

function segments(path: string | undefined): string[] {
  return (path ?? '').split('/').filter(Boolean);
}

/**
 * The header's breadcrumbs for the active tab. A virtual tab's id is not a
 * path (`diff:unstaged:/abs/repo:file`), so it is described by the tab's own
 * repo-relative `path` instead; splitting the id would put a temp folder in
 * the header.
 */
export function tabBreadcrumbs(activeTabId: string | null, tab: Tab | undefined): string[] {
  if (!activeTabId) return [ROOT];
  if (isDiffTabId(activeTabId)) return [ROOT, 'Diff', ...segments(tab?.path)];
  if (isMergeTabId(activeTabId)) return [ROOT, 'Merge', ...segments(tab?.path)];
  if (isReviewTabId(activeTabId)) return [ROOT, tab?.name ?? 'Review'];
  return [ROOT, ...segments(activeTabId)];
}

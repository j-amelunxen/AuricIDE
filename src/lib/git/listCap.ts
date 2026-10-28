/**
 * How many rows a Source Control section draws before it asks. Every row is a
 * DOM node with its own handlers; a repository where a build output or a
 * package store slipped past `.gitignore` reports tens of thousands of
 * untracked files, and drawing them all froze the window. The counts in the
 * headers and on the badge stay the real numbers — only the drawing is capped.
 */
export const GIT_LIST_PAGE_SIZE = 500;

export interface CappedList<T> {
  shown: T[];
  hidden: number;
}

export function capList<T>(items: T[], limit: number): CappedList<T> {
  if (items.length <= limit) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, limit), hidden: items.length - limit };
}

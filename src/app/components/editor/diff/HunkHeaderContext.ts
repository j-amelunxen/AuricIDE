import { createContext, useContext, type ReactNode } from 'react';

/**
 * Lets the owner of a diff put controls on each `@@` header: hunk actions and
 * risk chips in the diff viewer, accept and discard in a review. Optional; a
 * view without a provider renders bare headers as before.
 */
export interface HunkHeaderApi {
  /** Rendered at the right end of hunk `hunkIndex`'s header row. */
  renderHunkHeader: (hunkIndex: number) => ReactNode;
  /** The hunk keyboard actions apply to; its header is marked and its toolbar stays visible. */
  focusedHunk: number | null;
  /**
   * When set, hunk headers take programmatic focus (the review moves focus
   * from hunk to hunk) and are named by this, e.g. "Hunk 2 of 3 in a.ts".
   */
  describeHunk?: (hunkIndex: number) => string;
}

export const HunkHeaderContext = createContext<HunkHeaderApi | null>(null);

export function useHunkHeader(): HunkHeaderApi | null {
  return useContext(HunkHeaderContext);
}

/** Classes for a hunk header row: a hover group for its toolbar, a ring when it is focused. */
export function hunkHeaderClass(api: HunkHeaderApi | null, hunkIndex: number | undefined): string {
  if (!api || hunkIndex === undefined) return '';
  const focused = api.focusedHunk === hunkIndex;
  return `group/hunk items-center outline-none${focused ? ' ring-1 ring-inset ring-primary/60' : ''}`;
}

/** Focusability and name of a hunk header row, for owners that move focus between hunks. */
export function hunkHeaderAttrs(
  api: HunkHeaderApi | null,
  hunkIndex: number | undefined
): { tabIndex?: number; 'aria-label'?: string; role?: string } {
  if (!api?.describeHunk || hunkIndex === undefined) return {};
  return { tabIndex: -1, role: 'group', 'aria-label': api.describeHunk(hunkIndex) };
}

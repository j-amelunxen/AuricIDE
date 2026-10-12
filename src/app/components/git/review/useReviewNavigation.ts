'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  firstStop,
  focusStops,
  hunkCountOf,
  nextFileStop,
  stepStop,
  stopAfterAction,
  stopAfterViewed,
  type FocusFile,
  type FocusStop,
} from '@/lib/git/review/reviewFocus';
import type { ReviewFile, ViewedState } from '@/lib/git/review/reviewSession';
import { useStore } from '@/lib/store';
import type { ReviewActionOutcome, ReviewHunkKeys } from './useWorktreeHunks';

export interface ReviewEntry {
  file: ReviewFile;
  viewed: ViewedState;
}

/** How many unread files open by themselves. */
export const OPEN_BY_DEFAULT = 10;

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Looked up by attribute value rather than a selector, so no path needs escaping. */
function sectionFor(container: HTMLElement | null, path: string): HTMLElement | undefined {
  return Array.from(container?.querySelectorAll<HTMLElement>('[data-review-path]') ?? []).find(
    (el) => el.getAttribute('data-review-path') === path
  );
}

function focusStopElement(container: HTMLElement | null, stop: FocusStop): boolean {
  const section = sectionFor(container, stop.path);
  if (!section) return false;
  const target =
    stop.hunk === null
      ? section.querySelector<HTMLElement>('[data-review-header]')
      : section.querySelector<HTMLElement>(`[data-hunk-index="${stop.hunk}"]`);
  if (!target) return false;
  target.focus({ preventScroll: true });
  (stop.hunk === null ? section : target).scrollIntoView?.({
    block: stop.hunk === null ? 'start' : 'nearest',
  });
  return true;
}

function isTypingTarget(target: EventTarget): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'checkbox';
}

function sameStop(a: FocusStop | null, b: FocusStop | null): boolean {
  return !!a && !!b && a.path === b.path && a.hunk === b.hunk;
}

function stopKey(stop: FocusStop | null): string {
  return stop ? `${stop.path}#${stop.hunk ?? 'h'}` : '';
}

/** Opens the comment composer on a hunk of one file; `false` when the hunk has no line to comment. */
export type ReviewComposerOpener = (hunk: number) => boolean;

const OUTCOME_WORD: Record<Exclude<ReviewActionOutcome, 'kept'>, string> = {
  accepted: 'Accepted',
  unaccepted: 'Undid accept of',
  discarded: 'Discarded',
};

/**
 * The review's focused-hunk model (`reviewFocus.ts`) wired to the DOM. Focus
 * moves only on purpose: on open, on a key, and after an action, always to the
 * next decision. When the reviewer clicks or tabs somewhere, the model follows
 * without moving anything. If a re-render leaves focus on `body`, it is put
 * back on the current stop.
 */
// code-gate: complexity-function-length - the keyboard model of one view; split further it only passes refs around
export function useReviewNavigation(
  tabId: string,
  entries: readonly ReviewEntry[],
  refs: {
    /** The scrolling column of file sections. */
    scrollRef: RefObject<HTMLDivElement | null>;
    /** The verdict button `⌘↵` focuses, and where focus goes when nothing is left to decide. */
    primaryRef: RefObject<HTMLButtonElement | null>;
  },
  announce: (message: string) => void
) {
  const { scrollRef, primaryRef } = refs;
  const [focus, setFocus] = useState<FocusStop | null>(null);
  const [moveNonce, setMoveNonce] = useState(0);
  const [verdictNonce, setVerdictNonce] = useState(0);
  // Only what the reviewer folded or unfolded by hand; otherwise viewed files are folded.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const keysRef = useRef(new Map<string, ReviewHunkKeys>());
  const composersRef = useRef(new Map<string, ReviewComposerOpener>());

  // Only the first few files still to read open by themselves; a 200-file change set would
  // otherwise render every patch at once. The window moves on as files are marked viewed.
  const openByDefault = useMemo(
    () =>
      new Set(
        entries
          .filter((e) => e.viewed !== 'viewed')
          .slice(0, OPEN_BY_DEFAULT)
          .map((e) => e.file.path)
      ),
    [entries]
  );
  const isCollapsed = useCallback(
    (entry: ReviewEntry) => !(expanded[entry.file.path] ?? openByDefault.has(entry.file.path)),
    [expanded, openByDefault]
  );
  /** Files still to read that are folded only to keep the view fast. */
  const foldedToReview = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.viewed !== 'viewed' &&
          !openByDefault.has(e.file.path) &&
          expanded[e.file.path] === undefined
      ).length,
    [entries, expanded, openByDefault]
  );
  const focusFiles = useMemo<FocusFile[]>(
    () =>
      entries.map((e) => ({
        path: e.file.path,
        patch: e.file.patch,
        collapsed: isCollapsed(e),
        viewed: e.viewed === 'viewed',
      })),
    [entries, isCollapsed]
  );
  const stops = useMemo(() => focusStops(focusFiles), [focusFiles]);

  // The stop the keys act on: the chosen one while it exists, a header when its hunk went away.
  const effective = useMemo<FocusStop | null>(() => {
    const file = focus && focusFiles.find((f) => f.path === focus.path);
    if (!focus || !file) return firstStop(focusFiles);
    if (focus.hunk !== null && (file.collapsed || focus.hunk >= hunkCountOf(file.patch))) {
      return { path: focus.path, hunk: null };
    }
    return focus;
  }, [focus, focusFiles]);

  const latest = useRef({ effective, stops, focusFiles });
  useEffect(() => {
    latest.current = { effective, stops, focusFiles };
  });

  const moveTo = useCallback((stop: FocusStop | null) => {
    if (!stop) {
      // After the render: the verdict that can be given may change with this very action.
      setVerdictNonce((n) => n + 1);
      return;
    }
    setFocus(stop);
    setMoveNonce((n) => n + 1);
  }, []);

  // Moves real focus: once when the review first has files, then on every deliberate move.
  const handledNonce = useRef(-1);
  const effectiveKey = stopKey(effective);
  useEffect(() => {
    if (!effective || handledNonce.current === moveNonce) return;
    if (focusStopElement(scrollRef.current, effective)) handledNonce.current = moveNonce;
    // effectiveKey stands in for `effective`, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveNonce, effectiveKey, scrollRef]);

  useEffect(() => {
    if (verdictNonce > 0) primaryRef.current?.focus();
  }, [primaryRef, verdictNonce]);

  // Never `body`: a reload that replaced the focused node puts focus back on the current stop.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const stop = latest.current.effective;
    if (stop && scrollRef.current?.isConnected) focusStopElement(scrollRef.current, stop);
  }, [entries, scrollRef]);

  const followFocus = useCallback((path: string, hunk: number | null) => {
    setFocus((prev) => (sameStop(prev, { path, hunk }) ? prev : { path, hunk }));
  }, []);

  const registerKeys = useCallback((path: string, keys: ReviewHunkKeys | null) => {
    if (keys) keysRef.current.set(path, keys);
    else keysRef.current.delete(path);
  }, []);

  const registerComposer = useCallback((path: string, open: ReviewComposerOpener | null) => {
    if (open) composersRef.current.set(path, open);
    else composersRef.current.delete(path);
  }, []);

  const toggleCollapsed = useCallback((path: string) => {
    const file = latest.current.focusFiles.find((f) => f.path === path);
    if (!file) return;
    setExpanded((prev) => ({ ...prev, [path]: file.collapsed }));
  }, []);

  const toggleViewed = useCallback(
    (path: string) => {
      const { focusFiles: files } = latest.current;
      const file = files.find((f) => f.path === path);
      if (!file) return;
      useStore.getState().toggleViewed(tabId, path);
      setExpanded(({ [path]: _manual, ...rest }) => rest);
      if (file.viewed) {
        announce(`${basename(path)} no longer marked viewed`);
        moveTo({ path, hunk: null });
        return;
      }
      announce(`${basename(path)} marked viewed`);
      const after = files.map((f) => (f.path === path ? { ...f, viewed: true } : f));
      moveTo(stopAfterViewed(after, path));
    },
    [announce, moveTo, tabId]
  );

  const onHunkActed = useCallback(
    (path: string, hunk: number, outcome: ReviewActionOutcome) => {
      const at = { path, hunk };
      if (outcome !== 'kept') {
        announce(`${OUTCOME_WORD[outcome]} hunk ${hunk + 1} in ${basename(path)}`);
      }
      const { stops: current } = latest.current;
      if (outcome === 'accepted') moveTo(stopAfterAction(current, at, 'accept') ?? at);
      else if (outcome === 'discarded') moveTo(stopAfterAction(current, at, 'discard'));
      else moveTo(at);
    },
    [announce, moveTo]
  );

  const onFileActed = useCallback(
    (path: string, outcome: ReviewActionOutcome) => {
      if (outcome === 'kept') {
        moveTo({ path, hunk: null });
        return;
      }
      announce(`${outcome === 'accepted' ? 'Accepted' : 'Discarded'} ${basename(path)}`);
      if (outcome === 'accepted') {
        moveTo({ path, hunk: null });
        return;
      }
      // The discarded file leaves the review: on to the next file, or back to the one before.
      const { focusFiles: files } = latest.current;
      const index = files.findIndex((f) => f.path === path);
      const neighbour = files[index + 1] ?? files[index - 1];
      moveTo(neighbour ? { path: neighbour.path, hunk: null } : null);
    },
    [announce, moveTo]
  );

  const onCommentDone = useCallback(
    (_path: string, outcome: 'saved' | 'cancelled') => {
      if (outcome === 'saved') announce('Comment saved');
      moveTo(latest.current.effective);
    },
    [announce, moveTo]
  );

  const runHunkKey = (kind: 'accept' | 'discard') => {
    if (!effective || effective.hunk === null) return;
    const keys = keysRef.current.get(effective.path);
    if (!keys) return;
    void (kind === 'accept' ? keys.toggleAccept(effective.hunk) : keys.discard(effective.hunk));
  };

  // The composer focuses itself; saving or cancelling comes back through `onCommentDone`.
  const openComposer = () => {
    if (!effective || effective.hunk === null) return;
    composersRef.current.get(effective.path)?.(effective.hunk);
  };

  const keyAction = (event: KeyboardEvent<HTMLDivElement>): (() => void) | null => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      // No verdict to give yet: go to what blocks it, the first file still to read.
      return () =>
        primaryRef.current ? primaryRef.current.focus() : moveTo(firstStop(focusFiles));
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return null;
    const down = () => moveTo(stepStop(stops, effective, 1) ?? effective);
    const up = () => moveTo(stepStop(stops, effective, -1) ?? effective);
    const onHunk = effective?.hunk !== null && effective !== null;
    const viewed = effective ? () => toggleViewed(effective.path) : null;
    // Folding takes the focused hunk with it, so focus stays on the file's header.
    const fold = effective
      ? () => {
          toggleCollapsed(effective.path);
          moveTo({ path: effective.path, hunk: null });
        }
      : null;
    const accept = () => runHunkKey('accept');
    const discard = () => runHunkKey('discard');
    // Keys that act on a hunk do nothing on a file header.
    const hunkKeys: Record<string, () => void> = onHunk
      ? {
          s: accept,
          S: accept,
          Backspace: discard,
          Delete: discard,
          c: openComposer,
          C: openComposer,
        }
      : {};
    const table: Record<string, (() => void) | null> = {
      ArrowDown: down,
      j: down,
      ArrowUp: up,
      k: up,
      ']': () => moveTo(nextFileStop(focusFiles, effective, 1)),
      '[': () => moveTo(nextFileStop(focusFiles, effective, -1)),
      v: viewed,
      V: viewed,
      o: fold,
      O: fold,
      ...hunkKeys,
    };
    return table[event.key] ?? null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(event.target)) return;
    const action = keyAction(event);
    if (!action) return;
    event.preventDefault();
    action();
  };

  return {
    focus: effective,
    foldedToReview,
    isCollapsed,
    toggleCollapsed,
    toggleViewed,
    moveTo,
    followFocus,
    registerKeys,
    registerComposer,
    onHunkActed,
    onFileActed,
    onCommentDone,
    onKeyDown,
  };
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { firstChildOf, type GraphRow } from '@/lib/git/graphLayout';
import type { GitRef, GraphCommit } from '@/lib/tauri/gitGraph';
import {
  LOAD_MORE_MARGIN_ROWS,
  ROW_HEIGHT,
  laneColumnWidth,
  scrollTopToCentre,
  scrollTopToShow,
  visibleRange,
} from './graphGeometry';
import { GraphRowItem, graphRowDomId, type Point } from './GraphRowItem';

/** Used until the list has been measured (and wherever layout does not exist, as in tests). */
const FALLBACK_VIEWPORT_HEIGHT = 600;
const PULSE_MS = 1000;
const NO_REFS: GitRef[] = [];

export interface RevealRequest {
  oid: string;
  pulse: boolean;
  /** A new value asks again for the same commit. */
  nonce: number;
}

export interface GraphListProps {
  commits: GraphCommit[];
  /** `rows[i]` is the layout of `commits[i]`. */
  rows: GraphRow[];
  refsByOid: Map<string, GitRef[]>;
  selectedOid: string | null;
  matches: ReadonlySet<string>;
  searching: boolean;
  /** Commits outside the branch filter, or null when nothing is filtered. */
  dimmedOids: ReadonlySet<string> | null;
  headOid: string | null;
  busyOid: string | null;
  hasMore: boolean;
  nowMs: number;
  reveal: RevealRequest | null;
  onSelect: (oid: string) => void;
  onLoadMore: () => void;
  onToggleInspector: () => void;
  onCopySha: (oid: string) => void;
  onEscape: () => void;
  onCommitContextMenu: (commit: GraphCommit, point: Point, viaKeyboard: boolean) => void;
  onRefContextMenu: (ref: GitRef, point: Point) => void;
}

function useViewportHeight(scroller: React.RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => el.clientHeight > 0 && setHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scroller]);
  return height;
}

export function GraphList(props: GraphListProps) {
  const { commits, rows, selectedOid, reveal, hasMore, onLoadMore } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [pulseOid, setPulseOid] = useState<string | null>(null);
  const viewport = useViewportHeight(scroller);

  const indexByOid = useMemo(() => new Map(commits.map((c, i) => [c.oid, i])), [commits]);
  const childOf = useMemo(() => firstChildOf(commits), [commits]);
  const laneWidth = useMemo(() => laneColumnWidth(rows), [rows]);
  const range = visibleRange(scrollTop, viewport, commits.length);
  const selectedIndex = selectedOid ? (indexByOid.get(selectedOid) ?? -1) : -1;

  // The selected row stays rendered even when scrolled away, so aria-activedescendant always has a target.
  const renderedIndexes = useMemo(() => {
    const visible = Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
    const selectedOutside =
      selectedIndex >= 0 && (selectedIndex < range.start || selectedIndex >= range.end);
    return selectedOutside ? [...visible, selectedIndex] : visible;
  }, [range.start, range.end, selectedIndex]);

  // The DOM follows the state; the scroll event echoes the same value back.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollTop !== scrollTop) el.scrollTop = scrollTop;
  }, [scrollTop]);

  useEffect(() => {
    if (hasMore && range.end >= commits.length - LOAD_MORE_MARGIN_ROWS) onLoadMore();
  }, [hasMore, range.end, commits.length, onLoadMore]);

  // Only a change of selection scrolls it into view; the reader's own scrolling is never fought.
  const [seenSelectedOid, setSeenSelectedOid] = useState(selectedOid);
  if (selectedOid !== seenSelectedOid) {
    setSeenSelectedOid(selectedOid);
    if (selectedIndex >= 0) setScrollTop(scrollTopToShow(selectedIndex, scrollTop, viewport));
  }

  // A reveal request is answered once; the commit list changing must not replay it.
  const [seenRevealNonce, setSeenRevealNonce] = useState<number | null>(null);
  if (reveal && reveal.nonce !== seenRevealNonce) {
    setSeenRevealNonce(reveal.nonce);
    const index = indexByOid.get(reveal.oid);
    if (index !== undefined) {
      setScrollTop(scrollTopToCentre(index, viewport));
      setPulseOid(reveal.pulse ? reveal.oid : null);
    }
  }

  useEffect(() => {
    if (!pulseOid) return;
    const timer = window.setTimeout(() => setPulseOid(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulseOid]);

  const select = (index: number) => {
    const target = commits[Math.min(Math.max(index, 0), commits.length - 1)];
    if (target && target.oid !== selectedOid) props.onSelect(target.oid);
  };

  const openMenuAtSelection = () => {
    const commit = commits[selectedIndex];
    const rowEl = commit && document.getElementById(graphRowDomId(commit.oid));
    if (!commit || !rowEl) return;
    const box = rowEl.getBoundingClientRect();
    props.onCommitContextMenu(commit, { x: box.left + 80, y: box.bottom }, true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT));
    const selected = commits[selectedIndex];
    const handlers: Record<string, () => void> = {
      ArrowDown: () => select(selectedIndex + 1),
      ArrowUp: () => selectedIndex > 0 && select(selectedIndex - 1),
      PageDown: () => select(selectedIndex + page),
      PageUp: () => select(selectedIndex - page),
      Home: () => select(0),
      End: () => select(commits.length - 1),
      ArrowLeft: () =>
        selected?.parents[0] &&
        indexByOid.has(selected.parents[0]) &&
        props.onSelect(selected.parents[0]),
      ArrowRight: () =>
        selected && childOf.has(selected.oid) && props.onSelect(childOf.get(selected.oid)!),
      Enter: props.onToggleInspector,
      Escape: props.onEscape,
      ContextMenu: openMenuAtSelection,
    };
    if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
      if (selected) props.onCopySha(selected.oid);
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.shiftKey && event.key === 'F10' ? 'ContextMenu' : event.key;
    const handler = handlers[key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  return (
    <div
      ref={scroller}
      role="listbox"
      aria-label="Commits"
      aria-activedescendant={
        selectedOid && selectedIndex >= 0 ? graphRowDomId(selectedOid) : undefined
      }
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="@container group/list relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary/70"
    >
      <div className="relative" style={{ height: commits.length * ROW_HEIGHT }}>
        {renderedIndexes.map((index) => {
          const commit = commits[index];
          const row = rows[index];
          if (!row) return null;
          return (
            <GraphRowItem
              key={commit.oid}
              index={index}
              count={commits.length}
              commit={commit}
              row={row}
              refs={props.refsByOid.get(commit.oid) ?? NO_REFS}
              laneWidth={laneWidth}
              nowMs={props.nowMs}
              selected={commit.oid === selectedOid}
              match={props.matches.has(commit.oid)}
              fadedByQuery={props.searching && !props.matches.has(commit.oid)}
              dimmed={props.dimmedOids?.has(commit.oid) ?? false}
              isHead={commit.oid === props.headOid}
              busy={commit.oid === props.busyOid}
              pulse={commit.oid === pulseOid}
              onSelect={props.onSelect}
              onCommitContextMenu={props.onCommitContextMenu}
              onRefContextMenu={props.onRefContextMenu}
            />
          );
        })}
      </div>
    </div>
  );
}

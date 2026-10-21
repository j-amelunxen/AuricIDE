import { memo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { graphColorHex } from '@/lib/git/graphColors';
import type { GraphRow } from '@/lib/git/graphLayout';
import type { GitRef, GraphCommit } from '@/lib/tauri/gitGraph';
import { absoluteDate, relativeDate } from './graphDates';
import { ROW_HEIGHT } from './graphGeometry';
import { rowAriaLabel } from './graphRefs';
import { GraphLanes } from './GraphLanes';
import { RefPill } from './RefPill';

export interface Point {
  x: number;
  y: number;
}

const MAX_PILLS = 4;
const HOLE_BASE = 'var(--editor-bg)';

export function graphRowDomId(oid: string): string {
  return `graph-row-${oid}`;
}

interface GraphRowItemProps {
  index: number;
  count: number;
  commit: GraphCommit;
  row: GraphRow;
  refs: GitRef[];
  laneWidth: number;
  nowMs: number;
  selected: boolean;
  match: boolean;
  fadedByQuery: boolean;
  dimmed: boolean;
  isHead: boolean;
  busy: boolean;
  pulse: boolean;
  onSelect: (oid: string) => void;
  onCommitContextMenu: (commit: GraphCommit, point: Point, viaKeyboard: boolean) => void;
  onRefContextMenu: (ref: GitRef, point: Point) => void;
}

/**
 * Selection is neutral while the list is unfocused and the accent while it has
 * focus, like Xcode. The hollow merge dot's hole follows through `--graph-hole`.
 */
const SELECTED =
  'bg-[color-mix(in_srgb,var(--foreground)_14%,var(--editor-bg))] [--graph-hole:color-mix(in_srgb,var(--foreground)_14%,var(--editor-bg))] group-focus-within/list:bg-[color-mix(in_srgb,var(--primary)_28%,var(--editor-bg))] group-focus-within/list:[--graph-hole:color-mix(in_srgb,var(--primary)_28%,var(--editor-bg))]';

function rowClasses(p: GraphRowItemProps): string {
  const base =
    'absolute inset-x-0 flex cursor-default select-none items-center gap-2 pr-3 text-xs transition-colors duration-100 ease-out motion-reduce:transition-none';
  const surface = p.selected
    ? SELECTED
    : p.match
      ? 'bg-primary/10 hover:bg-primary/15'
      : 'hover:bg-hover-bg';
  return `${base} ${surface}`;
}

function GraphRowItemBase(props: GraphRowItemProps) {
  const { index, count, commit, row, refs, laneWidth, nowMs, selected } = props;
  const color = graphColorHex(row.color);
  const date = relativeDate(commit.authorTime, nowMs);
  const shown = refs.slice(0, MAX_PILLS);
  const hidden = refs.slice(MAX_PILLS);
  // Only lanes and pills fade; text stays at 70% or more so it keeps its contrast.
  const marks = props.dimmed ? 'opacity-40' : '';
  const text = props.dimmed || props.fadedByQuery ? 'opacity-70' : '';
  const secondary = selected ? 'text-foreground' : 'text-foreground-muted';

  return (
    <div
      id={graphRowDomId(commit.oid)}
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={count}
      aria-label={rowAriaLabel(commit.summary, commit.authorName, date, refs)}
      data-match={props.match ? 'true' : undefined}
      data-dimmed={props.dimmed ? 'true' : undefined}
      data-head={props.isHead ? 'true' : undefined}
      data-pulse={props.pulse ? 'true' : undefined}
      className={`${rowClasses(props)} ${props.pulse ? 'git-graph-head-pulse' : ''}`}
      style={
        {
          top: index * ROW_HEIGHT,
          height: ROW_HEIGHT,
          '--graph-hole': HOLE_BASE,
        } as React.CSSProperties
      }
      onClick={() => props.onSelect(commit.oid)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onCommitContextMenu(commit, { x: e.clientX, y: e.clientY }, false);
      }}
    >
      <span className={`flex shrink-0 ${marks}`}>
        <GraphLanes row={row} width={laneWidth} isHead={props.isHead} />
      </span>
      {shown.map((ref) => (
        <span key={ref.name} className={`flex shrink-0 ${marks}`}>
          <RefPill
            gitRef={ref}
            color={color}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onRefContextMenu(ref, { x: e.clientX, y: e.clientY });
            }}
          />
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          className="shrink-0 text-[11px] text-foreground-muted"
          title={hidden.map((r) => r.shorthand).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
      <span className={`min-w-0 flex-1 truncate text-foreground ${text}`}>{commit.summary}</span>
      {props.busy && (
        <span role="progressbar" aria-label="Working" className="shrink-0 animate-spin">
          <AuricIcon name="progress_activity" aria-hidden="true" className="text-sm" />
        </span>
      )}
      <span className={`hidden w-36 shrink-0 truncate @2xl:block ${secondary} ${text}`}>
        {commit.authorName}
      </span>
      <span
        className={`w-20 shrink-0 text-right tabular-nums ${secondary} ${text}`}
        title={absoluteDate(commit.authorTime)}
      >
        {date}
      </span>
    </div>
  );
}

export const GraphRowItem = memo(GraphRowItemBase);

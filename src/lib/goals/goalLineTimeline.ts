import type { GoalLine, LineStation } from './goalLinesLayout';

/**
 * Goal Lines as a tracker, not a map. A metro line spreads every station over
 * a fixed width, which stops being readable at about fifteen stations; a goal
 * plan routinely has ninety. These derivations feed the two shapes that
 * replace it: a progress capsule on the card (scales to any count) and a
 * vertical timeline in the detail view that folds the past and the far
 * future, the way a parcel tracker shows the step you are on.
 */

export interface HumanMark {
  id: string;
  /** 0..1 position along the capsule, the centre of the station's slot. */
  at: number;
}

export interface LineProgress {
  total: number;
  done: number;
  skipped: number;
  front: number;
  /** Planned and fog stations: everything still ahead. */
  open: number;
  /** Open human steps, so the capsule can show where a person is needed. */
  humanMarks: HumanMark[];
}

/** Counts the line's own stations (terminus excluded) for the capsule. */
export function lineProgress(line: GoalLine): LineProgress {
  const stations = ownStations(line);
  const total = stations.length;
  const count = (state: LineStation['state']) => stations.filter((s) => s.state === state).length;
  const humanMarks = stations.flatMap((s, i) =>
    s.kind === 'human' && s.state !== 'done' && s.state !== 'skipped'
      ? [{ id: s.id, at: (i + 0.5) / total }]
      : []
  );
  return {
    total,
    done: count('done'),
    skipped: count('skipped'),
    front: count('front'),
    open: count('planned') + count('fog'),
    humanMarks,
  };
}

export type FoldGroup = 'done' | 'skipped' | 'later';

export type TimelineRow =
  | { type: 'station'; station: LineStation }
  /** A folded run of stations; `count` is how many it hides while closed. */
  | { type: 'fold'; group: FoldGroup; count: number; open: boolean };

/** Done stations shown below the fold: the most recent ones. */
const RECENT_DONE = 2;
/** Stations ahead shown before the rest folds: the front and the next few. */
const AHEAD_VISIBLE = 6;

/** A done station whose evidence is weak or old still asks for a look. */
function needsLook(station: LineStation): boolean {
  return station.state === 'done' && (station.evidence === 'claim' || station.stale === true);
}

/**
 * The detail view's rows, top to bottom: the past (folded except for its
 * last steps and anything that needs a look), skipped decisions, the front
 * and the next few stations, the rest folded, and the terminus. `open`
 * names the folds the user has expanded; an open fold keeps its row so it
 * can be closed again.
 */
export function timelineRows(line: GoalLine, open: ReadonlySet<FoldGroup>): TimelineRow[] {
  const stations = ownStations(line);
  const terminus = line.stations[line.stations.length - 1];
  const rows: TimelineRow[] = [];

  const done = stations.filter((s) => s.state === 'done');
  const recent = new Set(done.slice(-RECENT_DONE).map((s) => s.id));
  const visibleDone = done.filter((s) => recent.has(s.id) || needsLook(s));
  const hiddenDone = done.length - visibleDone.length;
  if (hiddenDone > 0) {
    rows.push({ type: 'fold', group: 'done', count: hiddenDone, open: open.has('done') });
  }
  const shownDone = hiddenDone > 0 && open.has('done') ? done : visibleDone;
  rows.push(...shownDone.map((station) => ({ type: 'station' as const, station })));

  const skipped = stations.filter((s) => s.state === 'skipped');
  if (skipped.length > 0) {
    rows.push({ type: 'fold', group: 'skipped', count: skipped.length, open: open.has('skipped') });
    if (open.has('skipped')) {
      rows.push(...skipped.map((station) => ({ type: 'station' as const, station })));
    }
  }

  const ahead = stations.filter((s) => s.state !== 'done' && s.state !== 'skipped');
  rows.push(
    ...ahead.slice(0, AHEAD_VISIBLE).map((station) => ({ type: 'station' as const, station }))
  );
  const later = ahead.slice(AHEAD_VISIBLE);
  if (later.length > 0) {
    rows.push({ type: 'fold', group: 'later', count: later.length, open: open.has('later') });
    if (open.has('later')) {
      rows.push(...later.map((station) => ({ type: 'station' as const, station })));
    }
  }

  if (terminus?.kind === 'terminus') rows.push({ type: 'station', station: terminus });
  return rows;
}

/**
 * What a station's state means, in words — the replacement for the old
 * legend of rings, dashes and hollow dots. Null where the row needs no note
 * (a planned agent step; the front's agent is shown by the row itself).
 */
export function stationStatusText(station: LineStation): string | null {
  if (station.state === 'skipped') {
    return station.detail ? `skipped: ${station.detail}` : 'skipped';
  }
  if (station.state === 'done') {
    if (station.stale) return 'check is out of date';
    switch (station.evidence) {
      case 'proof':
        return 'verified';
      case 'judged':
        return 'AI-checked';
      case 'human':
        return 'confirmed by a person';
      case 'claim':
        return 'reported by the agent, not verified';
    }
  }
  if (station.kind === 'human') return 'your step';
  if (station.kind === 'gate') return 'review';
  if (station.state === 'fog') return 'waiting';
  return null;
}

function ownStations(line: GoalLine): LineStation[] {
  return line.stations.filter((s) => s.kind !== 'terminus');
}

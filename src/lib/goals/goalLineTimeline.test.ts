import { describe, expect, it } from 'vitest';
import type { GoalLine, LineStation } from './goalLinesLayout';
import {
  lineProgress,
  stationStatusText,
  timelineRows,
  type TimelineRow,
} from './goalLineTimeline';

function station(id: string, overrides: Partial<LineStation> = {}): LineStation {
  return {
    id,
    label: id,
    kind: 'normal',
    state: 'planned',
    evidence: 'claim',
    x: 0,
    agentIds: [],
    ...overrides,
  };
}

const terminus = station('terminus-g', { kind: 'terminus', label: 'Goal', evidence: 'proof' });

function line(stations: LineStation[], overrides: Partial<GoalLine> = {}): GoalLine {
  return {
    goalId: 'g',
    name: 'Goal',
    hue: '#fff',
    stations: [...stations, terminus],
    lastDone: null,
    now: null,
    next: null,
    satisfied: false,
    blockers: [],
    planCommitted: true,
    workMode: 'stations',
    progress: { done: 0, total: stations.length, unit: 'stations' },
    ...overrides,
  };
}

/** `count` stations: the first `done` verified, then one front, the rest planned. */
function longLine(count: number, done: number): GoalLine {
  return line(
    Array.from({ length: count }, (_, i) =>
      station(`s${i}`, {
        state: i < done ? 'done' : i === done ? 'front' : 'planned',
        evidence: i < done ? 'proof' : 'claim',
      })
    )
  );
}

const ids = (rows: TimelineRow[]) =>
  rows.map((r) => (r.type === 'station' ? r.station.id : `${r.type}:${r.group}:${r.count}`));

describe('lineProgress', () => {
  it('counts the states and leaves the terminus out', () => {
    const p = lineProgress(
      line([
        station('a', { state: 'done' }),
        station('b', { state: 'skipped' }),
        station('c', { state: 'front' }),
        station('d'),
        station('e', { state: 'fog' }),
      ])
    );
    expect(p).toMatchObject({ total: 5, done: 1, skipped: 1, front: 1, open: 2 });
  });

  it('marks open human steps at their place on the line, done ones not at all', () => {
    const p = lineProgress(
      line([
        station('a', { state: 'done' }),
        station('h1', { kind: 'human', state: 'done' }),
        station('b', { state: 'front' }),
        station('h2', { kind: 'human' }),
      ])
    );
    expect(p.humanMarks).toEqual([{ id: 'h2', at: 0.875 }]);
  });

  it('is all zero for a line with no stations of its own', () => {
    expect(lineProgress(line([]))).toMatchObject({ total: 0, done: 0, open: 0 });
  });
});

describe('timelineRows', () => {
  it('shows a short line in full, terminus last', () => {
    const rows = timelineRows(longLine(5, 2), new Set());
    expect(ids(rows)).toEqual(['s0', 's1', 's2', 's3', 's4', 'terminus-g']);
  });

  it('folds a 93-station line to the recent past, the front and the next five', () => {
    const rows = timelineRows(longLine(93, 42), new Set());
    expect(ids(rows)).toEqual([
      'fold:done:40',
      's40',
      's41',
      's42',
      's43',
      's44',
      's45',
      's46',
      's47',
      'fold:later:45',
      'terminus-g',
    ]);
  });

  it('keeps a done station that still needs a look visible inside the fold', () => {
    const l = longLine(20, 10);
    l.stations[2] = { ...l.stations[2], evidence: 'claim' };
    l.stations[4] = { ...l.stations[4], stale: true };
    const rows = timelineRows(l, new Set());
    expect(ids(rows).slice(0, 5)).toEqual(['fold:done:6', 's2', 's4', 's8', 's9']);
  });

  it('folds skipped stations into their own row', () => {
    const l = line([
      station('a', { state: 'done', evidence: 'proof' }),
      station('b', { state: 'skipped', detail: 'not needed' }),
      station('c', { state: 'front' }),
    ]);
    expect(ids(timelineRows(l, new Set()))).toEqual(['a', 'fold:skipped:1', 'c', 'terminus-g']);
  });

  it('opens a fold in place and keeps its toggle row', () => {
    const rows = timelineRows(longLine(93, 42), new Set(['done', 'later']));
    const shown = ids(rows);
    expect(shown[0]).toBe('fold:done:40');
    expect(shown).toContain('s0');
    expect(shown).toContain('s92');
    expect(shown.filter((id) => id.startsWith('s'))).toHaveLength(93);
    expect(rows.find((r) => r.type === 'fold' && r.group === 'done')).toMatchObject({
      open: true,
    });
  });

  it('shows a finished line as its last steps and the reached terminus', () => {
    const rows = timelineRows(longLine(10, 10), new Set());
    expect(ids(rows)).toEqual(['fold:done:8', 's8', 's9', 'terminus-g']);
  });
});

describe('stationStatusText', () => {
  it('says in words how sure a done station is', () => {
    expect(stationStatusText(station('a', { state: 'done', evidence: 'proof' }))).toBe('verified');
    expect(stationStatusText(station('a', { state: 'done', evidence: 'judged' }))).toBe(
      'AI-checked'
    );
    expect(stationStatusText(station('a', { state: 'done', evidence: 'human' }))).toBe(
      'confirmed by a person'
    );
    expect(stationStatusText(station('a', { state: 'done', evidence: 'claim' }))).toBe(
      'reported by the agent, not verified'
    );
    expect(stationStatusText(station('a', { state: 'done', evidence: 'proof', stale: true }))).toBe(
      'check is out of date'
    );
  });

  it('names who an open step waits for', () => {
    expect(stationStatusText(station('h', { kind: 'human' }))).toBe('your step');
    expect(stationStatusText(station('g', { kind: 'gate' }))).toBe('review');
    expect(stationStatusText(station('f', { state: 'fog' }))).toBe('waiting');
    expect(stationStatusText(station('p'))).toBe(null);
  });

  it('gives a skip its reason', () => {
    expect(stationStatusText(station('s', { state: 'skipped', detail: 'covered by X' }))).toBe(
      'skipped: covered by X'
    );
  });
});

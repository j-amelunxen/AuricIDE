import { describe, expect, it } from 'vitest';
import {
  fleetHeartbeatMax,
  heartbeatBandFor,
  heartbeatLatest,
  heartbeatPeak,
  heartbeatSeries,
  HEARTBEAT_WINDOW_MINUTES,
  pushHeartbeat,
  type HeartbeatBucket,
} from './heartbeat';

const MINUTE = 60_000;

describe('heartbeatBandFor', () => {
  it('maps the working kinds to their own bands', () => {
    expect(heartbeatBandFor('edit')).toBe('edit');
    expect(heartbeatBandFor('run')).toBe('run');
    expect(heartbeatBandFor('ask')).toBe('ask');
    expect(heartbeatBandFor('read')).toBe('read');
  });

  it('folds prose in with reading — one band nobody can tell apart at 22px', () => {
    expect(heartbeatBandFor('note')).toBe('read');
  });

  it('keeps outcomes in the total rather than dropping them', () => {
    expect(heartbeatBandFor('done')).toBe('run');
    expect(heartbeatBandFor('error')).toBe('run');
  });
});

describe('pushHeartbeat', () => {
  it('counts events into the current minute', () => {
    const buckets = pushHeartbeat([], ['edit', 'edit', 'run'], 5 * MINUTE);
    expect(buckets).toEqual([{ minute: 5, counts: { edit: 2, run: 1 } }]);
  });

  it('adds to the open bucket while the minute lasts', () => {
    const first = pushHeartbeat([], ['edit'], 5 * MINUTE);
    const second = pushHeartbeat(first, ['run'], 5 * MINUTE + 30_000);
    expect(second).toEqual([{ minute: 5, counts: { edit: 1, run: 1 } }]);
  });

  it('opens a new bucket when the minute rolls over', () => {
    const first = pushHeartbeat([], ['edit'], 5 * MINUTE);
    const second = pushHeartbeat(first, ['edit'], 6 * MINUTE);
    expect(second).toHaveLength(2);
    expect(second[1].minute).toBe(6);
  });

  it('returns the same array when nothing happened', () => {
    // A chunk of pure redraw noise must not cost every heartbeat-derived
    // memo a recompute.
    const buckets: HeartbeatBucket[] = [{ minute: 5, counts: { edit: 1 } }];
    expect(pushHeartbeat(buckets, [], 5 * MINUTE)).toBe(buckets);
  });

  it('does not mutate the buckets it was given', () => {
    const buckets: HeartbeatBucket[] = [{ minute: 5, counts: { edit: 1 } }];
    pushHeartbeat(buckets, ['edit'], 5 * MINUTE);
    expect(buckets[0].counts).toEqual({ edit: 1 });
  });

  it('drops buckets past the retention window', () => {
    let buckets: HeartbeatBucket[] = [];
    for (let m = 0; m < HEARTBEAT_WINDOW_MINUTES + 10; m++) {
      buckets = pushHeartbeat(buckets, ['run'], m * MINUTE);
    }
    expect(buckets).toHaveLength(HEARTBEAT_WINDOW_MINUTES);
    expect(buckets[0].minute).toBe(10);
  });
});

describe('heartbeatSeries', () => {
  it('returns one sample per minute of the window, oldest first', () => {
    const series = heartbeatSeries([], 100 * MINUTE);
    expect(series).toHaveLength(HEARTBEAT_WINDOW_MINUTES);
    expect(series.every((s) => s.total === 0)).toBe(true);
  });

  it('places a bucket at the right end of the window', () => {
    const series = heartbeatSeries([{ minute: 100, counts: { edit: 3 } }], 100 * MINUTE);
    expect(series[HEARTBEAT_WINDOW_MINUTES - 1]).toEqual({ counts: { edit: 3 }, total: 3 });
  });

  it('fills quiet minutes with an empty sample rather than skipping them', () => {
    // Skipping them would compress the time axis and make a gap in the work
    // look like continuous activity.
    const series = heartbeatSeries(
      [
        { minute: 98, counts: { run: 1 } },
        { minute: 100, counts: { run: 1 } },
      ],
      100 * MINUTE
    );
    expect(series[HEARTBEAT_WINDOW_MINUTES - 2].total).toBe(0);
  });

  it('totals every band in a sample', () => {
    const series = heartbeatSeries(
      [{ minute: 100, counts: { edit: 2, run: 1, ask: 1, read: 4 } }],
      100 * MINUTE
    );
    expect(series[HEARTBEAT_WINDOW_MINUTES - 1].total).toBe(8);
  });

  it('drops buckets that have scrolled out of the window', () => {
    const series = heartbeatSeries([{ minute: 1, counts: { edit: 9 } }], 100 * MINUTE);
    expect(series.every((s) => s.total === 0)).toBe(true);
  });
});

describe('fleetHeartbeatMax', () => {
  it('finds the tallest minute across every agent', () => {
    const a = heartbeatSeries([{ minute: 100, counts: { edit: 3 } }], 100 * MINUTE);
    const b = heartbeatSeries([{ minute: 100, counts: { read: 11 } }], 100 * MINUTE);
    expect(fleetHeartbeatMax([a, b])).toBe(11);
  });

  it('never returns zero, so an idle fleet still divides by something', () => {
    expect(fleetHeartbeatMax([])).toBe(1);
    expect(fleetHeartbeatMax([heartbeatSeries([], 100 * MINUTE)])).toBe(1);
  });

  it('is what makes two cards comparable at all', () => {
    // The old chart normalised each card to its own peak, so one event and a
    // hundred drew the same height. A shared scale is the whole fix.
    const quiet = heartbeatSeries([{ minute: 100, counts: { edit: 1 } }], 100 * MINUTE);
    const busy = heartbeatSeries([{ minute: 100, counts: { edit: 100 } }], 100 * MINUTE);
    const max = fleetHeartbeatMax([quiet, busy]);
    expect(heartbeatPeak(quiet) / max).toBeLessThan(heartbeatPeak(busy) / max);
  });
});

describe('heartbeatPeak and heartbeatLatest', () => {
  it('reports the busiest minute in the window', () => {
    const series = heartbeatSeries(
      [
        { minute: 99, counts: { edit: 7 } },
        { minute: 100, counts: { edit: 2 } },
      ],
      100 * MINUTE
    );
    expect(heartbeatPeak(series)).toBe(7);
  });

  it('reports the most recent minute for the label beside the chart', () => {
    const series = heartbeatSeries(
      [
        { minute: 99, counts: { edit: 7 } },
        { minute: 100, counts: { edit: 2 } },
      ],
      100 * MINUTE
    );
    expect(heartbeatLatest(series)).toBe(2);
  });

  it('reads zero for an agent that has done nothing', () => {
    expect(heartbeatPeak([])).toBe(0);
    expect(heartbeatLatest([])).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { pushHeartbeat, heartbeatSeries } from './heartbeat';
import type { HeartbeatBucket } from './heartbeat';

const MINUTE = 60_000;

describe('pushHeartbeat', () => {
  it('opens a new bucket for the first byte count', () => {
    expect(pushHeartbeat([], 100, 0)).toEqual([{ minute: 0, bytes: 100 }]);
  });

  it('accumulates bytes within the same minute rather than adding a bucket', () => {
    const buckets = pushHeartbeat([{ minute: 0, bytes: 100 }], 50, 30_000);
    expect(buckets).toEqual([{ minute: 0, bytes: 150 }]);
  });

  it('opens a new bucket once the minute rolls over', () => {
    const buckets = pushHeartbeat([{ minute: 0, bytes: 100 }], 50, MINUTE);
    expect(buckets).toEqual([
      { minute: 0, bytes: 100 },
      { minute: 1, bytes: 50 },
    ]);
  });

  it('keeps only the last 24 buckets, dropping the oldest', () => {
    const buckets: HeartbeatBucket[] = Array.from({ length: 24 }, (_, i) => ({
      minute: i,
      bytes: 1,
    }));
    const updated = pushHeartbeat(buckets, 5, 24 * MINUTE);
    expect(updated).toHaveLength(24);
    expect(updated[0]).toEqual({ minute: 1, bytes: 1 });
    expect(updated[23]).toEqual({ minute: 24, bytes: 5 });
  });

  it('does not mutate the input array', () => {
    const buckets: HeartbeatBucket[] = [{ minute: 0, bytes: 1 }];
    const updated = pushHeartbeat(buckets, 1, 0);
    expect(updated).not.toBe(buckets);
    expect(buckets).toEqual([{ minute: 0, bytes: 1 }]);
  });
});

describe('heartbeatSeries', () => {
  it('returns 24 zeros for an empty history', () => {
    expect(heartbeatSeries([], 0)).toEqual(Array(24).fill(0));
  });

  it('fills the minutes with data and zeros the gaps, oldest to newest', () => {
    const buckets: HeartbeatBucket[] = [
      { minute: 0, bytes: 10 },
      { minute: 2, bytes: 30 },
    ];
    const series = heartbeatSeries(buckets, 2 * MINUTE);
    expect(series).toHaveLength(24);
    // Oldest of the 24-minute window is `now`'s minute minus 23.
    expect(series.slice(-3)).toEqual([10, 0, 30]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  createBreadcrumbs,
  createDriftProbe,
  createStallReporter,
  STALL_REPORT_MS,
} from './freezeProbe';

describe('breadcrumbs', () => {
  it('keeps only the newest entries', () => {
    let t = 0;
    const crumbs = createBreadcrumbs(3, () => t);
    for (const label of ['a', 'b', 'c', 'd']) {
      t += 10;
      crumbs.add(label);
    }
    expect(crumbs.recent(1_000).map((c) => c.label)).toEqual(['b', 'c', 'd']);
  });

  it('drops entries older than the window', () => {
    let t = 0;
    const crumbs = createBreadcrumbs(10, () => t);
    crumbs.add('old');
    t = 20_000;
    crumbs.add('new');
    expect(crumbs.recent(10_000).map((c) => c.label)).toEqual(['new']);
  });

  it('records how long a span took and what it carried', async () => {
    let t = 100;
    const crumbs = createBreadcrumbs(10, () => t);
    const result = await crumbs.span(
      'git-refresh',
      async () => {
        t = 450;
        return [1, 2, 3];
      },
      (value) => ({ statuses: value.length })
    );
    expect(result).toEqual([1, 2, 3]);
    expect(crumbs.recent(10_000)).toEqual([
      { label: 'git-refresh', atMs: 100, durationMs: 350, detail: { statuses: 3 } },
    ]);
  });

  it('records a span that throws and rethrows', async () => {
    let t = 0;
    const crumbs = createBreadcrumbs(10, () => t);
    await expect(
      crumbs.span('boom', async () => {
        t = 5;
        throw new Error('x');
      })
    ).rejects.toThrow('x');
    expect(crumbs.recent(10_000)[0]).toMatchObject({ label: 'boom', durationMs: 5, failed: true });
  });
});

describe('drift probe', () => {
  it('reports the time a timer fired late', () => {
    const onStall = vi.fn();
    let t = 0;
    const probe = createDriftProbe({ intervalMs: 250, thresholdMs: 200, now: () => t, onStall });
    t = 260;
    probe.check();
    expect(onStall).not.toHaveBeenCalled();
    t = 260 + 250 + 900;
    probe.check();
    expect(onStall).toHaveBeenCalledWith(900);
  });
});

describe('stall reporter', () => {
  it('writes a line with breadcrumbs and context for a long stall', () => {
    const write = vi.fn();
    const t = 50_000;
    const crumbs = createBreadcrumbs(10, () => t);
    crumbs.add('fs-flush', { dirs: 1 });
    const reporter = createStallReporter({
      now: () => t,
      unixNow: () => 1_700_000_000_000,
      breadcrumbs: crumbs,
      context: () => ({ agentsRunning: 2 }),
      write,
    });
    reporter.report('drift', STALL_REPORT_MS + 1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      atMs: 1_700_000_000_000,
      source: 'probe',
      kind: 'drift',
      durationMs: STALL_REPORT_MS + 1,
      context: { agentsRunning: 2 },
      breadcrumbs: [{ label: 'fs-flush', atMs: 50_000, detail: { dirs: 1 } }],
    });
  });

  it('ignores short stalls and folds a burst into one line per second', () => {
    const write = vi.fn();
    let t = 0;
    const reporter = createStallReporter({
      now: () => t,
      unixNow: () => t,
      breadcrumbs: createBreadcrumbs(10, () => t),
      context: () => ({}),
      write,
    });
    reporter.report('drift', STALL_REPORT_MS - 1);
    expect(write).not.toHaveBeenCalled();
    reporter.report('drift', 300);
    t = 500;
    reporter.report('drift', 400);
    expect(write).toHaveBeenCalledTimes(1);
    t = 1_600;
    reporter.report('drift', 250);
    expect(write).toHaveBeenCalledTimes(2);
    // The folded stall is not lost: it rides along on the next line.
    expect(JSON.parse(write.mock.calls[1][0])).toMatchObject({
      durationMs: 250,
      foldedMs: 400,
      foldedCount: 1,
    });
  });
});

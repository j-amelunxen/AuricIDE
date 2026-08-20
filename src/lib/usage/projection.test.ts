import { describe, expect, it } from 'vitest';

import { hatchSpan, paceCaption, projectWindow } from './projection';
import type { UsageSample, UsageWindow } from './types';

const HOUR = 3600;
const DAY = 24 * HOUR;

/** A Tuesday noon, so the remaining-time arithmetic stays readable. */
const NOW_SECS = 1_800_000_000;
const NOW_MS = NOW_SECS * 1000;

function weekly(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return {
    limitId: 'codex',
    limitLabel: null,
    kind: '7d',
    label: '7 d',
    usedPercent: 40,
    resetsAt: NOW_SECS + 4 * DAY,
    windowMinutes: 10080,
    ...overrides,
  };
}

function fiveHour(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return {
    limitId: 'claude',
    limitLabel: null,
    kind: '5h',
    label: '5 h',
    usedPercent: 30,
    resetsAt: NOW_SECS + 3 * HOUR,
    windowMinutes: 300,
    ...overrides,
  };
}

function sample(
  observedAt: number,
  windows: Array<
    Pick<UsageWindow, 'limitId' | 'kind' | 'usedPercent' | 'resetsAt' | 'windowMinutes'>
  >,
  provider = 'codex'
): UsageSample {
  return { provider, observedAt, windows };
}

describe('projectWindow', () => {
  it('says nothing when there is no earlier reading to be a rate from', () => {
    // A single percentage is a fuel gauge, not a forecast. Inventing a slope
    // from one point would be a claim the data cannot support.
    expect(
      projectWindow(weekly(), { provider: 'codex', observedAt: NOW_SECS }, [], NOW_MS)
    ).toBeNull();
  });

  it('says nothing when the two readings are minutes apart', () => {
    // Fifteen minutes of noise is not a week's pace. The first Codex poll
    // after a reading lands here; wait for a span that can carry a slope.
    const history = [sample(NOW_SECS - 5 * 60, [weekly({ usedPercent: 39 })])];
    expect(
      projectWindow(weekly(), { provider: 'codex', observedAt: NOW_SECS }, history, NOW_MS)
    ).toBeNull();
  });

  it("projects the last day's pace across the rest of the week", () => {
    // 20 % used in the last 24 h, 40 % used now, four days left: the same
    // workload would spend another 80 % and land at 120 % of the window.
    const history = [sample(NOW_SECS - DAY, [weekly({ usedPercent: 20 })])];
    const projection = projectWindow(
      weekly(),
      { provider: 'codex', observedAt: NOW_SECS },
      history,
      NOW_MS
    );
    expect(projection).not.toBeNull();
    expect(projection!.projectedPercent).toBeCloseTo(120, 5);
    expect(projection!.confidence).toBe('ok');
  });

  it('takes the recent day, not the whole window so far', () => {
    // An older, quieter stretch must not dilute "how you are working now".
    // From 5 % two days ago the whole-window slope would land near 110 %;
    // the last day alone is the 120 % above.
    const history = [
      sample(NOW_SECS - 2 * DAY, [weekly({ usedPercent: 5 })]),
      sample(NOW_SECS - DAY, [weekly({ usedPercent: 20 })]),
    ];
    const projection = projectWindow(
      weekly(),
      { provider: 'codex', observedAt: NOW_SECS },
      history,
      NOW_MS
    );
    expect(projection!.projectedPercent).toBeCloseTo(120, 5);
  });

  it('drops samples from the previous window after a reset', () => {
    // A 90 % → 5 % drop is a new cycle, not a negative rate. Projecting
    // across it would forecast that usage is falling when it has only begun.
    const previousReset = NOW_SECS - 3 * DAY;
    const history = [
      sample(NOW_SECS - 2 * DAY, [weekly({ usedPercent: 90, resetsAt: previousReset })]),
      sample(NOW_SECS - DAY, [weekly({ usedPercent: 5 })]),
    ];
    const projection = projectWindow(
      weekly({ usedPercent: 15 }),
      { provider: 'codex', observedAt: NOW_SECS },
      history,
      NOW_MS
    );
    expect(projection!.projectedPercent).toBeCloseTo(55, 5);
  });

  it('ignores another provider and another window on the same sample', () => {
    const history = [
      sample(NOW_SECS - DAY, [
        weekly({ usedPercent: 20 }),
        fiveHour({ usedPercent: 80, resetsAt: NOW_SECS + 3 * HOUR }),
      ]),
      sample(
        NOW_SECS - DAY,
        [fiveHour({ usedPercent: 10, resetsAt: NOW_SECS + 3 * HOUR })],
        'claude'
      ),
    ];
    const projection = projectWindow(
      weekly(),
      { provider: 'codex', observedAt: NOW_SECS },
      history,
      NOW_MS
    );
    expect(projection!.projectedPercent).toBeCloseTo(120, 5);
  });

  it('uses an hour of lookback on a five-hour window, not a day', () => {
    // A session window has no "typical day". The last hour is the pace; the
    // hours before it are a different stretch of the same five hours.
    const history = [
      sample(NOW_SECS - 3 * HOUR, [fiveHour({ usedPercent: 5 })], 'claude'),
      sample(NOW_SECS - HOUR, [fiveHour({ usedPercent: 20 })], 'claude'),
    ];
    const projection = projectWindow(
      fiveHour(),
      { provider: 'claude', observedAt: NOW_SECS },
      history,
      NOW_MS
    );
    // 10 % in the last hour, three hours left → +30, land at 60.
    expect(projection!.projectedPercent).toBeCloseTo(60, 5);
  });

  it('says nothing while the window is idle', () => {
    // A flat reading is "you are not spending". Projecting that as a landing
    // of 40 % would draw a hatch that is just the current fill in a costume.
    const history = [sample(NOW_SECS - DAY, [weekly({ usedPercent: 40 })])];
    expect(
      projectWindow(weekly(), { provider: 'codex', observedAt: NOW_SECS }, history, NOW_MS)
    ).toBeNull();
  });

  it('says nothing when the reset is already due', () => {
    const history = [
      sample(NOW_SECS - DAY, [weekly({ usedPercent: 20, resetsAt: NOW_SECS - 10 })]),
    ];
    expect(
      projectWindow(
        weekly({ resetsAt: NOW_SECS - 10 }),
        { provider: 'codex', observedAt: NOW_SECS },
        history,
        NOW_MS
      )
    ).toBeNull();
  });

  it('marks a short span as a thin reading rather than hiding it', () => {
    // Two Codex polls an hour apart are already a slope, just a noisy one.
    // The UI gets to show a "~" instead of pretending this is a day's pace.
    const history = [sample(NOW_SECS - HOUR, [weekly({ usedPercent: 38 })])];
    const projection = projectWindow(
      weekly(),
      { provider: 'codex', observedAt: NOW_SECS },
      history,
      NOW_MS
    );
    expect(projection).not.toBeNull();
    expect(projection!.confidence).toBe('thin');
    expect(projection!.projectedPercent).toBeGreaterThan(40);
  });
});

describe('paceCaption', () => {
  it('names the landing when the pace fits the window', () => {
    expect(
      paceCaption({
        projectedPercent: 72.4,
        ratePerHour: 1,
        lookbackMs: DAY * 1000,
        confidence: 'ok',
      })
    ).toBe('on this pace, 72% by reset');
  });

  it('names the overshoot as a share of the window, not a landing past 100', () => {
    expect(
      paceCaption({
        projectedPercent: 120.4,
        ratePerHour: 1,
        lookbackMs: DAY * 1000,
        confidence: 'ok',
      })
    ).toBe('on this pace, 120% of this window');
  });

  it('marks a thin reading so the number is not taken as settled', () => {
    expect(
      paceCaption({
        projectedPercent: 120,
        ratePerHour: 1,
        lookbackMs: HOUR * 1000,
        confidence: 'thin',
      })
    ).toBe('on this pace, ~120% of this window');
  });
});

describe('hatchSpan', () => {
  it('covers the gap from the current fill to the projected landing, capped at 100', () => {
    expect(hatchSpan(40, 120)).toEqual({ start: 40, end: 100 });
    expect(hatchSpan(40, 72)).toEqual({ start: 40, end: 72 });
  });

  it('draws nothing when the hatch would be a sliver on a 4 px bar', () => {
    expect(hatchSpan(40, 40.4)).toBeNull();
    expect(hatchSpan(40, 39)).toBeNull();
  });
});

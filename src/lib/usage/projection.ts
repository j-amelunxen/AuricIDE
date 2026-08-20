/**
 * A forecast from a trail of quota readings, not from a single percentage.
 *
 * The CLIs only ever report how full a window is *now*. A slope — and so a
 * landing at reset — only exists once we have kept earlier readings ourselves.
 * This module is that slope: pure, so the interesting mistakes (projecting
 * across a reset, diluting "now" with last Tuesday, drawing a hatch from
 * noise) are tests rather than a rendering accident.
 */

import { formatPercent, msUntilReset } from './quota';
import type { UsageSample, UsageWindow } from './types';

/** Two readings closer than this are noise, not a pace. */
const MIN_SPAN_SECS = 10 * 60;
/** A drop this large is a new window, not a negative rate. */
const RESET_DROP_PERCENT = 5;
/** `resetsAt` jumping this far is a new cycle even without a drop. */
const RESET_AT_JUMP_SECS = 30 * 60;
/** Below this, the window is idle — no hatch, no forecast. */
const IDLE_RATE_PER_HOUR = 0.01;
/** Matches the Rust classifier: 5 h windows live at or below 8 h. */
const FIVE_HOUR_MAX_MINUTES = 480;
/** Matches the Rust classifier: 7 d windows live at or above 6 d. */
const SEVEN_DAY_MIN_MINUTES = 8640;
/** A 1.5-point hatch on a 4 px bar is a rounding artefact, not a signal. */
const MIN_HATCH_PERCENT = 1.5;

export type ProjectionConfidence = 'thin' | 'ok';

export interface QuotaProjection {
  /** Unclamped. 120 means the current pace would need 120 % of this window. */
  projectedPercent: number;
  /** Percentage points per hour over the lookback. */
  ratePerHour: number;
  /** How much of the lookback actually had samples, in milliseconds. */
  lookbackMs: number;
  confidence: ProjectionConfidence;
}

export interface HatchSpan {
  start: number;
  end: number;
}

interface Point {
  at: number;
  used: number;
  resetsAt: number;
}

/**
 * How far back "current pace" reaches.
 *
 * A five-hour session has no typical day — the last hour is the session.
 * A week does: the last day, sleep included, is the workload you would
 * repeat. Anything else takes a seventh of its own length.
 */
function lookbackSecs(windowMinutes: number): number {
  if (windowMinutes <= FIVE_HOUR_MAX_MINUTES) return 60 * 60;
  if (windowMinutes >= SEVEN_DAY_MIN_MINUTES) return 24 * 60 * 60;
  return Math.max(MIN_SPAN_SECS, Math.floor((windowMinutes * 60) / 7));
}

function matchingWindow(sample: UsageSample, provider: string, window: UsageWindow) {
  if (sample.provider !== provider) return undefined;
  return sample.windows.find(
    (candidate) =>
      candidate.kind === window.kind &&
      candidate.windowMinutes === window.windowMinutes &&
      candidate.limitId === window.limitId
  );
}

function collectPoints(
  window: UsageWindow,
  current: { provider: string; observedAt: number },
  history: UsageSample[]
): Point[] {
  const points: Point[] = [];
  for (const sample of history) {
    if (sample.observedAt > current.observedAt) continue;
    const match = matchingWindow(sample, current.provider, window);
    if (!match) continue;
    if (sample.observedAt === current.observedAt) continue;
    points.push({
      at: sample.observedAt,
      used: match.usedPercent,
      resetsAt: match.resetsAt,
    });
  }
  points.push({
    at: current.observedAt,
    used: window.usedPercent,
    resetsAt: window.resetsAt,
  });
  points.sort((a, b) => a.at - b.at);
  return points;
}

/**
 * Keep only the current cycle. A reset is a drop, or `resetsAt` leaping to a
 * new timestamp — either one would otherwise turn "the window started over"
 * into a forecast that usage is falling.
 */
function lastSegment(points: Point[]): Point[] {
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const next = points[i];
    const drop = previous.used - next.used;
    const jump = Math.abs(next.resetsAt - previous.resetsAt);
    if (drop >= RESET_DROP_PERCENT || jump > RESET_AT_JUMP_SECS) {
      start = i;
    }
  }
  return points.slice(start);
}

export function projectWindow(
  window: UsageWindow,
  current: { provider: string; observedAt: number },
  history: UsageSample[],
  nowMs: number
): QuotaProjection | null {
  if (msUntilReset(window.resetsAt, nowMs) <= 0) return null;

  const segment = lastSegment(collectPoints(window, current, history));
  if (segment.length < 2) return null;

  const latest = segment[segment.length - 1];
  const lookback = lookbackSecs(window.windowMinutes);
  const inLookback = segment.filter((point) => point.at >= latest.at - lookback);
  if (inLookback.length < 2) return null;

  const first = inLookback[0];
  const last = inLookback[inLookback.length - 1];
  const spanSecs = last.at - first.at;
  if (spanSecs < MIN_SPAN_SECS) return null;

  const ratePerHour = (last.used - first.used) / (spanSecs / 3600);
  if (ratePerHour <= IDLE_RATE_PER_HOUR) return null;

  const remainingHours = msUntilReset(window.resetsAt, nowMs) / 3_600_000;
  const projectedPercent = last.used + ratePerHour * remainingHours;
  const confidence: ProjectionConfidence = spanSecs >= lookback / 2 ? 'ok' : 'thin';

  return {
    projectedPercent,
    ratePerHour,
    lookbackMs: spanSecs * 1000,
    confidence,
  };
}

export function paceCaption(projection: QuotaProjection): string {
  const figure = formatPercent(projection.projectedPercent);
  const approx = projection.confidence === 'thin' ? '~' : '';
  const landing = `${approx}${figure}`;
  if (Math.round(projection.projectedPercent) > 100) {
    return `on this pace, ${landing} of this window`;
  }
  return `on this pace, ${landing} by reset`;
}

/**
 * The slice of the bar that is forecast rather than measured, in percent of
 * the track. Capped at 100: an overshoot is a label, not a bar past the end.
 */
export function hatchSpan(usedPercent: number, projectedPercent: number): HatchSpan | null {
  const start = Math.min(100, Math.max(0, usedPercent));
  const end = Math.min(100, Math.max(0, projectedPercent));
  if (end - start < MIN_HATCH_PERCENT) return null;
  return { start, end };
}

/**
 * What the status bar says about a set of quota readings.
 *
 * All of it is pure, because the interesting decisions here are the ones that
 * are easy to get quietly wrong: which number leads, when it stops being calm,
 * and — the one that matters most — the difference between "measured, and it is
 * low" and "not measured at all".
 */

import type { UsageSnapshot, UsageWindow } from './types';

/** Above this share of a window, the chip stops being quiet. */
export const WARN_PERCENT = 60;
/** Above this, it says so plainly. */
export const CRITICAL_PERCENT = 85;

export type QuotaTone = 'calm' | 'warn' | 'critical';

/** Short provider tags, so two readings fit in a status bar. */
const PROVIDER_TAGS: Record<string, string> = {
  claude: 'CC',
  codex: 'CX',
};

export function providerTag(provider: string): string {
  return PROVIDER_TAGS[provider] ?? provider.slice(0, 2).toUpperCase();
}

export function providerName(provider: string): string {
  if (provider === 'claude') return 'Claude Code';
  if (provider === 'codex') return 'Codex';
  return provider;
}

export function quotaTone(usedPercent: number): QuotaTone {
  if (usedPercent >= CRITICAL_PERCENT) return 'critical';
  if (usedPercent >= WARN_PERCENT) return 'warn';
  return 'calm';
}

/**
 * The window closest to running out, across every provider.
 *
 * A snapshot with no windows contributes nothing rather than a zero — an
 * account that reports no quota has made no statement about how much is left.
 */
export function worstWindow(snapshots: UsageSnapshot[]): UsageWindow | null {
  let worst: UsageWindow | null = null;
  for (const snapshot of snapshots) {
    for (const window of snapshot.windows) {
      if (!worst || window.usedPercent > worst.usedPercent) {
        worst = window;
      }
    }
  }
  return worst;
}

/** The tone the chip as a whole should carry. */
export function overallTone(snapshots: UsageSnapshot[]): QuotaTone {
  const worst = worstWindow(snapshots);
  return worst ? quotaTone(worst.usedPercent) : 'calm';
}

export interface ChipSegment {
  provider: string;
  tag: string;
  usedPercent: number;
  tone: QuotaTone;
}

/**
 * One segment per provider that actually reported something, leading with its
 * own worst window. A provider with no windows is left out entirely rather than
 * shown at zero.
 */
export function chipSegments(snapshots: UsageSnapshot[]): ChipSegment[] {
  return snapshots
    .map((snapshot) => {
      const worst = worstWindow([snapshot]);
      if (!worst) return null;
      return {
        provider: snapshot.provider,
        tag: providerTag(snapshot.provider),
        usedPercent: worst.usedPercent,
        tone: quotaTone(worst.usedPercent),
      };
    })
    .filter((segment): segment is ChipSegment => segment !== null);
}

/** Percentages read better without trailing noise; 23.5 % is not a useful 23.5. */
export function formatPercent(usedPercent: number): string {
  return `${Math.round(usedPercent)}%`;
}

/**
 * Milliseconds until a window resets, floored at zero.
 *
 * A window whose reset time has passed has not been re-read yet — the caller
 * renders that as "due", never as a negative countdown.
 */
export function msUntilReset(resetsAt: number, nowMs: number): number {
  return Math.max(0, resetsAt * 1000 - nowMs);
}

/**
 * How old a reading is, in milliseconds.
 *
 * Never negative: a clock that moved should not make a reading look like it
 * comes from the future.
 */
export function ageMs(observedAt: number, nowMs: number): number {
  return Math.max(0, nowMs - observedAt * 1000);
}

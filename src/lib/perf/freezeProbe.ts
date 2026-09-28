/**
 * Frontend half of freeze detection. The Rust watchdog (`ui_watchdog.rs`)
 * notices that the UI stopped answering; this side says what ran just
 * before and catches the shorter stalls the watchdog's one-second cadence
 * cannot see.
 *
 * Both write to `<app_log_dir>/freezes.jsonl`; `scripts/freeze-report.mjs`
 * summarises the file.
 *
 * WKWebView supports neither `longtask` nor `long-animation-frame` today,
 * so the drift probe — a timer that measures how late it fires — is what
 * actually measures in the installed app. The observers are used where the
 * engine offers them, and then the drift probe stands down so a stall is
 * not reported twice.
 */

/** A stall shorter than this is not written. */
export const STALL_REPORT_MS = 200;
const BREADCRUMB_WINDOW_MS = 10_000;
const MIN_LINE_INTERVAL_MS = 1_000;

export interface Breadcrumb {
  label: string;
  atMs: number;
  durationMs?: number;
  detail?: Record<string, unknown>;
  failed?: true;
}

export interface Breadcrumbs {
  add(label: string, detail?: Record<string, unknown>): void;
  /**
   * Runs `fn` and records how long it took. `describe` turns the result into
   * the size figures worth keeping (entry counts, not the payload itself).
   */
  span<T>(
    label: string,
    fn: () => Promise<T>,
    describe?: (value: T) => Record<string, unknown>
  ): Promise<T>;
  recent(windowMs: number): Breadcrumb[];
}

export function createBreadcrumbs(capacity: number, now: () => number): Breadcrumbs {
  const ring: Breadcrumb[] = [];
  const push = (crumb: Breadcrumb) => {
    ring.push(crumb);
    if (ring.length > capacity) ring.shift();
  };
  return {
    add(label, detail) {
      push(detail ? { label, atMs: now(), detail } : { label, atMs: now() });
    },
    async span(label, fn, describe) {
      const atMs = now();
      try {
        const value = await fn();
        const crumb: Breadcrumb = { label, atMs, durationMs: now() - atMs };
        if (describe) crumb.detail = describe(value);
        push(crumb);
        return value;
      } catch (error) {
        push({ label, atMs, durationMs: now() - atMs, failed: true });
        throw error;
      }
    },
    recent(windowMs) {
      const cutoff = now() - windowMs;
      return ring.filter((c) => c.atMs >= cutoff);
    },
  };
}

interface DriftProbeOptions {
  intervalMs: number;
  thresholdMs: number;
  now: () => number;
  onStall: (lateByMs: number) => void;
}

/** `check` is meant to run every `intervalMs`; it reports how late it ran. */
export function createDriftProbe({ intervalMs, thresholdMs, now, onStall }: DriftProbeOptions) {
  let last = now();
  return {
    /** Restart the measurement, e.g. after the page was hidden and throttled. */
    reset() {
      last = now();
    },
    check() {
      const t = now();
      const late = t - last - intervalMs;
      last = t;
      if (late >= thresholdMs) onStall(late);
    },
  };
}

interface StallReporterOptions {
  now: () => number;
  unixNow: () => number;
  breadcrumbs: Breadcrumbs;
  context: () => Record<string, unknown>;
  write: (line: string) => void;
}

/**
 * Turns stalls into log lines. Under sustained load a stall arrives every
 * few hundred milliseconds; those are folded into the next line rather than
 * written one by one, so the log does not become its own source of load.
 */
export function createStallReporter({
  now,
  unixNow,
  breadcrumbs,
  context,
  write,
}: StallReporterOptions) {
  let lastWriteAt = -Infinity;
  let foldedMs = 0;
  let foldedCount = 0;
  return {
    report(kind: string, durationMs: number) {
      if (durationMs < STALL_REPORT_MS) return;
      const t = now();
      if (t - lastWriteAt < MIN_LINE_INTERVAL_MS) {
        foldedMs += durationMs;
        foldedCount += 1;
        return;
      }
      lastWriteAt = t;
      const line: Record<string, unknown> = {
        atMs: unixNow(),
        source: 'probe',
        kind,
        durationMs: Math.round(durationMs),
        context: context(),
        breadcrumbs: breadcrumbs.recent(BREADCRUMB_WINDOW_MS),
      };
      if (foldedCount > 0) {
        line.foldedMs = Math.round(foldedMs);
        line.foldedCount = foldedCount;
        foldedMs = 0;
        foldedCount = 0;
      }
      write(JSON.stringify(line));
    },
  };
}

/** The app-wide ring the expensive paths write their spans into. */
export const perfBreadcrumbs = createBreadcrumbs(30, () => performance.now());

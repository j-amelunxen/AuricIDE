'use client';

import { formatDuration } from '@/lib/pm/metrics/time';
import { statusName } from '@/lib/pm/labels';

export interface TimingRow {
  label: string;
  value: string;
}

/** The lifecycle figures tickets and goals both have (`lib/pm/metrics/lifecycle.ts`). */
interface LifecycleTiming {
  currentStatus: string;
  timeInCurrentStatus: number | null;
  timeInStatus: Record<string, number>;
  cycleTime: number | null;
  leadTime: number | null;
}

/**
 * The rows of a Timing box: the current status, every earlier spell, then
 * `extra` (a goal's review rounds), cycle and lead time. Absent figures are left out.
 */
export function timingRows(metrics: LifecycleTiming, extra: TimingRow[] = []): TimingRow[] {
  const rows: TimingRow[] = [];
  if (metrics.timeInCurrentStatus !== null) {
    rows.push({
      label: statusName(metrics.currentStatus),
      value: formatDuration(metrics.timeInCurrentStatus),
    });
  }
  for (const [spellStatus, ms] of Object.entries(metrics.timeInStatus)) {
    rows.push({ label: statusName(spellStatus), value: formatDuration(ms) });
  }
  rows.push(...extra);
  if (metrics.cycleTime !== null) {
    rows.push({ label: 'Cycle', value: formatDuration(metrics.cycleTime) });
  }
  if (metrics.leadTime !== null) {
    rows.push({ label: 'Lead', value: formatDuration(metrics.leadTime) });
  }
  return rows;
}

interface TimingCardProps {
  rows: TimingRow[];
  /** A caveat under the figures, e.g. where the record starts. */
  note?: string;
}

/** The "Timing" box shared by tickets and goals. Renders nothing without rows. */
export function TimingCard({ rows, note }: TimingCardProps) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-muted mb-2">
        Timing
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {/* A status can appear twice: once as "now", once as an earlier spell. */}
        {rows.map((row, index) => (
          <div key={`${index}-${row.label}`} className="contents">
            <dt className="text-foreground-muted">{row.label}</dt>
            <dd className="text-right text-foreground tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-2 text-[11px] text-foreground-muted">{note}</p>}
    </div>
  );
}

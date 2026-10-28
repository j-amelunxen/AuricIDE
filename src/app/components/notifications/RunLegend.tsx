'use client';

import type { RunState } from '@/lib/notifications/scheduleCalendar';

/** The dot for one run state. Colour comes from the project, state from the shape. */
export function runDotStyle(state: RunState, color: string): React.CSSProperties {
  if (state === 'upcoming') return { border: `1.5px solid ${color}`, background: 'transparent' };
  if (state === 'failed') return { background: '#ff4a4a', boxShadow: '0 0 0 2px #ff4a4a40' };
  return { background: color };
}

export function RunLegend({
  truncated,
  futureFailed,
}: {
  truncated: boolean;
  futureFailed: boolean;
}) {
  return (
    <div
      data-testid="schedule-run-legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] text-foreground-muted"
    >
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={runDotStyle('upcoming', '#9aa')} />
        due
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={runDotStyle('fired', '#9aa')} />
        fired
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={runDotStyle('failed', '#9aa')} />
        failed = run reported an error
      </span>
      {truncated && (
        <span data-testid="schedule-runs-truncated" className="text-[#ffce2e]">
          Some schedules have more runs than shown (first 200 each).
        </span>
      )}
      {futureFailed && (
        <span data-testid="schedule-runs-future-failed" className="text-[#ff4a4a]">
          Upcoming runs could not be computed.
        </span>
      )}
    </div>
  );
}

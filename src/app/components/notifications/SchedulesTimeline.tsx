'use client';

import { useMemo, useState } from 'react';
import { useScheduleRuns } from '@/lib/hooks/useScheduleRuns';
import {
  buildLanes,
  clusterRuns,
  DAY,
  projectColor,
  type ScheduleRun,
  type TimelineLanes,
} from '@/lib/notifications/scheduleCalendar';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { RunLegend, runDotStyle } from './RunLegend';

export interface SchedulesTimelineProps {
  schedules: Schedule[];
  notifications: Notification[];
  now: number;
  onEdit: (schedule: Schedule) => void;
}

const HOUR = 3_600_000;

/** How far back and forward each zoom reaches; the future gets most of the room. */
const ZOOMS = {
  '24h': { label: '24 hours', before: 6 * HOUR, after: 18 * HOUR, tick: 3 * HOUR },
  '7d': { label: '7 days', before: 2 * DAY, after: 5 * DAY, tick: DAY },
  '30d': { label: '30 days', before: 7 * DAY, after: 23 * DAY, tick: 5 * DAY },
} as const;
type Zoom = keyof typeof ZOOMS;

/** Dots closer than this fraction of the axis merge into one counted cluster. */
const MIN_GAP = 0.012;

const dayTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const dayOnly = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' });
const hourOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * Runs along a horizontal time axis, one lane per project (or per schedule).
 * The window is anchored at the current hour, so "now" stays put as the clock
 * ticks and the dots do not creep sideways under the cursor.
 */
export function SchedulesTimeline({
  schedules,
  notifications,
  now,
  onEdit,
}: SchedulesTimelineProps) {
  const [zoom, setZoom] = useState<Zoom>('7d');
  const [laneMode, setLaneMode] = useState<TimelineLanes>('project');

  const anchor = Math.floor(now / HOUR) * HOUR;
  const { before, after, tick } = ZOOMS[zoom];
  const from = anchor - before;
  const to = anchor + after;
  const span = to - from;

  const { runs, truncated, futureFailed } = useScheduleRuns(
    schedules,
    notifications,
    from,
    to,
    now
  );
  const lanes = useMemo(() => buildLanes(schedules, laneMode), [schedules, laneMode]);
  const byId = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules]
  );

  const runsByLane = useMemo(() => {
    const laneOf = new Map<string, string>();
    for (const lane of lanes) for (const id of lane.scheduleIds) laneOf.set(id, lane.key);
    const map = new Map<string, ScheduleRun[]>();
    for (const run of runs) {
      const key = laneOf.get(run.scheduleId);
      if (key !== undefined) map.set(key, [...(map.get(key) ?? []), run]);
    }
    return map;
  }, [runs, lanes]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const first = Math.ceil(from / tick) * tick;
    for (let at = first; at < to; at += tick) out.push(at);
    return out;
  }, [from, to, tick]);

  const nowPos = ((now - from) / span) * 100;
  const tickLabel = (at: number) => (zoom === '24h' ? hourOnly.format(at) : dayOnly.format(at));

  return (
    <div data-testid="schedules-timeline">
      <div className="flex flex-wrap items-center gap-2 px-3 pb-1">
        <div
          role="radiogroup"
          aria-label="Timeline range"
          className="flex rounded-lg border border-white/10 p-0.5"
        >
          {(Object.keys(ZOOMS) as Zoom[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={zoom === key}
              data-testid={`timeline-zoom-${key}`}
              onClick={() => setZoom(key)}
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                zoom === key
                  ? 'bg-white/10 text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {ZOOMS[key].label}
            </button>
          ))}
        </div>
        <div
          role="radiogroup"
          aria-label="Lanes"
          className="flex rounded-lg border border-white/10 p-0.5"
        >
          {(['project', 'schedule'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={laneMode === mode}
              data-testid={`timeline-lanes-${mode}`}
              onClick={() => setLaneMode(mode)}
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                laneMode === mode
                  ? 'bg-white/10 text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {mode === 'project' ? 'Lane per project' : 'Lane per schedule'}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-2 overflow-hidden rounded-lg border border-white/10">
        <div className="relative grid grid-cols-[9rem_minmax(0,1fr)] text-[10px]">
          {nowPos > 0 && nowPos < 100 && (
            <span
              data-testid="timeline-now"
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/70"
              style={{ left: `calc(9rem + (100% - 9rem) * ${nowPos / 100})` }}
            />
          )}
          <div className="border-b border-white/10" />
          <div className="relative h-5 border-b border-white/10">
            {ticks.map((at) => (
              <span
                key={at}
                className="absolute top-1 -translate-x-1/2 font-mono text-[9px] text-foreground-muted/60"
                style={{ left: `${((at - from) / span) * 100}%` }}
              >
                {tickLabel(at)}
              </span>
            ))}
          </div>

          {lanes.length === 0 && (
            <p className="col-span-2 px-3 py-3 text-[11px] text-foreground-muted">No schedules.</p>
          )}
          {lanes.map((lane) => {
            const clusters = clusterRuns(runsByLane.get(lane.key) ?? [], from, to, MIN_GAP);
            return (
              <div key={lane.key} data-testid={`timeline-lane-${lane.key}`} className="contents">
                <div className="flex items-center gap-1.5 truncate border-t border-white/5 px-2 py-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: projectColor(lane.path) }}
                  />
                  <span
                    className="truncate text-[10px] font-semibold text-foreground"
                    title={lane.label}
                  >
                    {lane.label}
                  </span>
                </div>
                <div className="relative h-7 border-t border-white/5">
                  {ticks.map((at) => (
                    <span
                      key={at}
                      aria-hidden="true"
                      className="absolute inset-y-0 w-px bg-white/[0.04]"
                      style={{ left: `${((at - from) / span) * 100}%` }}
                    />
                  ))}
                  {clusters.map((cluster) => {
                    const first = cluster.runs[0];
                    const schedule = byId.get(first.scheduleId);
                    if (schedule === undefined) return null;
                    const many = cluster.runs.length > 1;
                    const names = [
                      ...new Set(cluster.runs.map((run) => byId.get(run.scheduleId)?.name)),
                    ];
                    const title = many
                      ? `${cluster.runs.length} runs from ${dayTime.format(first.at)} · ${names.slice(0, 5).join(', ')}`
                      : `${schedule.name} · ${dayTime.format(first.at)} · ${first.state === 'upcoming' ? 'due' : first.state}`;
                    return (
                      <button
                        key={first.key}
                        type="button"
                        data-testid={`timeline-run-${first.key}`}
                        data-state={cluster.state}
                        data-count={cluster.runs.length}
                        title={title}
                        aria-label={title}
                        onClick={() => onEdit(schedule)}
                        className="absolute top-1/2 flex h-3.5 min-w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-0.5 text-[8px] font-bold text-black"
                        style={{
                          left: `${cluster.at * 100}%`,
                          ...runDotStyle(cluster.state, projectColor(schedule.projectPath)),
                          ...(cluster.state === 'upcoming' && many
                            ? { color: 'currentColor' }
                            : {}),
                        }}
                      >
                        {many ? cluster.runs.length : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <RunLegend truncated={truncated} futureFailed={futureFailed} />
    </div>
  );
}

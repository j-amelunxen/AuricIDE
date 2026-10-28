'use client';

import { useMemo, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useScheduleRuns } from '@/lib/hooks/useScheduleRuns';
import {
  addDays,
  cellOf,
  projectColor,
  startOfWeek,
  type ScheduleRun,
} from '@/lib/notifications/scheduleCalendar';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { RunLegend, runDotStyle } from './RunLegend';

export interface SchedulesCalendarProps {
  schedules: Schedule[];
  notifications: Notification[];
  now: number;
  onEdit: (schedule: Schedule) => void;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const CHIPS_PER_CELL = 3;
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function runTitle(run: ScheduleRun, schedule: Schedule): string {
  const state = run.state === 'upcoming' ? 'due' : run.state;
  return `${schedule.name} · ${timeFormat.format(run.at)} · ${state}`;
}

/**
 * One week, Monday to Sunday, local time. Each cell is one day × hour and
 * lists the runs that fall in it as small chips; a cell with more than
 * `CHIPS_PER_CELL` shows a "+N" that expands it — hundreds of schedules means
 * several runs an hour is normal, and a cell that grows silently would shove
 * the whole grid around.
 */
export function SchedulesCalendar({
  schedules,
  notifications,
  now,
  onEdit,
}: SchedulesCalendarProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(now));
  const [expanded, setExpanded] = useState<string | null>(null);
  const weekEnd = addDays(weekStart, 7);

  const { runs, truncated, futureFailed } = useScheduleRuns(
    schedules,
    notifications,
    weekStart,
    weekEnd,
    now
  );
  const byId = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules]
  );

  const cells = useMemo(() => {
    const map = new Map<string, ScheduleRun[]>();
    for (const run of runs) {
      const { day, minute } = cellOf(run.at, weekStart);
      const key = `${day}-${Math.floor(minute / 60)}`;
      map.set(key, [...(map.get(key) ?? []), run]);
    }
    return map;
  }, [runs, weekStart]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayColumn = days.findIndex((day) => now >= day && now < addDays(day, 1));
  const thisWeek = weekStart === startOfWeek(now);

  return (
    <div data-testid="schedules-calendar">
      <div className="flex items-center gap-1 px-3 pb-1">
        <button
          type="button"
          aria-label="Previous week"
          data-testid="calendar-prev"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="rounded p-0.5 text-foreground-muted hover:bg-white/10 hover:text-foreground"
        >
          <AuricIcon name="chevron_left" aria-hidden="true" className="text-sm" />
        </button>
        <button
          type="button"
          aria-label="Next week"
          data-testid="calendar-next"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="rounded p-0.5 text-foreground-muted hover:bg-white/10 hover:text-foreground"
        >
          <AuricIcon name="chevron_right" aria-hidden="true" className="text-sm" />
        </button>
        <button
          type="button"
          data-testid="calendar-today"
          disabled={thisWeek}
          onClick={() => setWeekStart(startOfWeek(now))}
          className="press-feedback rounded-lg border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-foreground-muted hover:bg-white/10 hover:text-foreground disabled:opacity-40"
        >
          Today
        </button>
        <span
          data-testid="calendar-range"
          className="ml-1 font-mono text-[10px] text-foreground-muted"
        >
          {dayFormat.format(weekStart)} – {dayFormat.format(addDays(weekStart, 6))}
        </span>
      </div>

      <div
        role="grid"
        aria-label="Schedule runs this week"
        className="mx-2 grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] overflow-hidden rounded-lg border border-white/10 text-[10px]"
      >
        <div role="row" className="contents">
          <div role="columnheader" className="border-b border-white/10" />
          {days.map((day, i) => (
            <div
              key={day}
              role="columnheader"
              className={`border-b border-l border-white/10 px-1 py-1 text-center font-mono ${
                i === todayColumn ? 'text-primary' : 'text-foreground-muted'
              }`}
            >
              {dayFormat.format(day)}
            </div>
          ))}
        </div>
        {HOURS.map((hour) => (
          <div key={hour} role="row" className="contents">
            <div
              role="rowheader"
              className="border-t border-white/5 pr-1 text-right font-mono text-[9px] text-foreground-muted/60"
            >
              {String(hour).padStart(2, '0')}
            </div>
            {days.map((_, day) => {
              const key = `${day}-${hour}`;
              const cell = cells.get(key) ?? [];
              const open = expanded === key;
              const shown = open ? cell : cell.slice(0, CHIPS_PER_CELL);
              return (
                <div
                  key={key}
                  role="gridcell"
                  data-testid={`calendar-cell-${key}`}
                  className={`flex min-h-[1.75rem] min-w-0 flex-wrap content-start gap-0.5 border-l border-t border-white/5 p-0.5 ${
                    day === todayColumn ? 'bg-primary/[0.04]' : ''
                  }`}
                >
                  {shown.map((run) => {
                    const schedule = byId.get(run.scheduleId);
                    if (schedule === undefined) return null;
                    return (
                      <button
                        key={run.key}
                        type="button"
                        data-testid={`calendar-run-${run.key}`}
                        data-state={run.state}
                        title={runTitle(run, schedule)}
                        aria-label={runTitle(run, schedule)}
                        onClick={() => onEdit(schedule)}
                        className={`flex max-w-full items-center gap-1 truncate rounded bg-white/[0.04] px-1 text-[9px] hover:bg-white/10 ${
                          run.state === 'upcoming' ? 'text-foreground-muted' : 'text-foreground'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                          style={runDotStyle(run.state, projectColor(schedule.projectPath))}
                        />
                        <span className="truncate">{schedule.name}</span>
                      </button>
                    );
                  })}
                  {cell.length > CHIPS_PER_CELL && (
                    <button
                      type="button"
                      data-testid={`calendar-more-${key}`}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : key)}
                      className="rounded px-1 text-[9px] font-semibold text-foreground-muted hover:bg-white/10"
                    >
                      {open ? 'less' : `+${cell.length - CHIPS_PER_CELL}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <RunLegend truncated={truncated} futureFailed={futureFailed} />
    </div>
  );
}

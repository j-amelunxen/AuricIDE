'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useScheduleRuns } from '@/lib/hooks/useScheduleRuns';
import {
  addDays,
  cellOf,
  projectColor,
  slotInstant,
  startOfWeek,
  type ScheduleRun,
} from '@/lib/notifications/scheduleCalendar';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { RunLegend, runDotStyle } from './RunLegend';
import { useRunDrag } from './useRunDrag';

export interface SchedulesCalendarProps {
  schedules: Schedule[];
  notifications: Notification[];
  now: number;
  onEdit: (schedule: Schedule) => void;
  /** A click on an empty slot: start a new schedule at that instant. */
  onCreate: (at: number) => void;
  /** An upcoming run dropped on another slot. */
  onMove: (schedule: Schedule, from: number, to: number) => void;
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
  const hint = run.state === 'upcoming' ? ' · drag to move' : '';
  return `${schedule.name} · ${timeFormat.format(run.at)} · ${state}${hint}`;
}

/** Which slot of which cell a pointer is over, read from the cell under it. */
function slotAt(weekStart: number, x: number, y: number): { key: string; at: number } | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot-day]');
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  const fraction = rect.height > 0 ? (y - rect.top) / rect.height : 0;
  const day = Number(cell.dataset.slotDay);
  const hour = Number(cell.dataset.slotHour);
  return { key: `${day}-${hour}`, at: slotInstant(weekStart, day, hour, fraction) };
}

/**
 * One week, Monday to Sunday, local time. Each cell is one day × hour and
 * lists the runs that fall in it as small chips; a cell with more than
 * `CHIPS_PER_CELL` shows a "+N" that expands it — hundreds of schedules means
 * several runs an hour is normal, and a cell that grows silently would shove
 * the whole grid around.
 *
 * The grid takes the height it is given (24 rows share it, none under
 * 1.75rem, then it scrolls), so a tall window shows the whole day at once.
 * An empty slot creates a schedule on click, an upcoming run moves on drag.
 */
export function SchedulesCalendar({
  schedules,
  notifications,
  now,
  onEdit,
  onCreate,
  onMove,
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

  const { drag, begin } = useRunDrag({
    resolveTarget: (x, y) => slotAt(weekStart, x, y)?.at ?? null,
    isValidTarget: (at) => at > now,
    onDrop: (run, to) => {
      const schedule = byId.get(run.scheduleId);
      if (schedule !== undefined) onMove(schedule, run.at, to);
    },
  });

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

  const ghost =
    drag?.targetAt !== undefined && drag.targetAt !== null
      ? cellOf(drag.targetAt, weekStart)
      : null;
  const ghostKey = ghost === null ? null : `${ghost.day}-${Math.floor(ghost.minute / 60)}`;
  const ghostSchedule = drag === null ? undefined : byId.get(drag.run.scheduleId);

  const createAt = (event: MouseEvent<HTMLElement>, day: number, hour: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
    onCreate(slotInstant(weekStart, day, hour, fraction));
  };

  return (
    <div data-testid="schedules-calendar" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-1 px-3 pb-1">
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
        <span className="ml-auto text-[10px] text-foreground-muted/70">
          Click a slot to add · drag a run to move it
        </span>
      </div>

      <div
        role="grid"
        aria-label="Schedule runs this week"
        className="mx-2 grid min-h-0 flex-1 grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] grid-rows-[auto_repeat(24,minmax(1.75rem,1fr))] overflow-y-auto rounded-lg border border-white/10 text-[10px]"
      >
        <div role="row" className="contents">
          <div
            role="columnheader"
            className="sticky top-0 z-20 border-b border-white/10 bg-background"
          />
          {days.map((day, i) => (
            <div
              key={day}
              role="columnheader"
              className={`sticky top-0 z-20 border-b border-l border-white/10 bg-background px-1 py-1 text-center font-mono ${
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
              const isTarget = ghostKey === key && ghost !== null;
              return (
                <div
                  key={key}
                  role="gridcell"
                  data-testid={`calendar-cell-${key}`}
                  data-slot-day={day}
                  data-slot-hour={hour}
                  title={drag === null ? 'Click to add a schedule here' : undefined}
                  onClick={(event) => createAt(event, day, hour)}
                  className={`group relative flex min-h-[1.75rem] min-w-0 cursor-crosshair flex-wrap content-start gap-0.5 border-l border-t border-white/5 p-0.5 transition-colors ${
                    day === todayColumn ? 'bg-primary/[0.04]' : ''
                  } ${drag === null ? 'hover:bg-white/[0.06]' : ''}`}
                >
                  {drag === null && (
                    <AuricIcon
                      name="add"
                      aria-hidden="true"
                      className="pointer-events-none absolute top-0.5 right-0.5 text-[11px] text-foreground-muted/0 group-hover:text-foreground-muted/60"
                    />
                  )}
                  {isTarget && ghostSchedule !== undefined && (
                    <div
                      data-testid="calendar-drop-ghost"
                      data-valid={drag?.valid}
                      aria-hidden="true"
                      className={`pointer-events-none absolute right-0.5 left-0.5 z-10 flex items-center gap-1 truncate rounded border border-dashed px-1 text-[9px] ${
                        drag?.valid
                          ? 'border-primary bg-primary/20 text-foreground'
                          : 'border-red-400/70 bg-red-400/10 text-red-300'
                      }`}
                      style={{ top: `${(ghost.minute % 60) / 0.6}%` }}
                    >
                      <span className="font-mono">{timeFormat.format(drag!.targetAt!)}</span>
                      <span className="truncate">{ghostSchedule.name}</span>
                    </div>
                  )}
                  {shown.map((run) => {
                    const schedule = byId.get(run.scheduleId);
                    if (schedule === undefined) return null;
                    const movable = run.state === 'upcoming';
                    return (
                      <button
                        key={run.key}
                        type="button"
                        data-testid={`calendar-run-${run.key}`}
                        data-state={run.state}
                        title={runTitle(run, schedule)}
                        aria-label={runTitle(run, schedule)}
                        onPointerDown={movable ? (event) => begin(event, run) : undefined}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(schedule);
                        }}
                        className={`relative z-[1] flex max-w-full items-center gap-1 truncate rounded bg-white/[0.04] px-1 text-[9px] hover:bg-white/10 hover:ring-1 hover:ring-white/20 ${
                          movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                        } ${run.state === 'upcoming' ? 'text-foreground-muted' : 'text-foreground'} ${
                          drag?.run.key === run.key ? 'opacity-40' : ''
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
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(open ? null : key);
                      }}
                      className="relative z-[1] cursor-pointer rounded px-1 text-[9px] font-semibold text-foreground-muted hover:bg-white/10"
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
      <div className="flex-shrink-0">
        <RunLegend truncated={truncated} futureFailed={futureFailed} />
      </div>
    </div>
  );
}

'use client';

import { WEEKDAY_OPTIONS } from '@/lib/notifications/scheduleFormat';
import type { RhythmChoice } from './types';
import { Field, INPUT } from './ui';

export interface RhythmSectionProps {
  rhythm: RhythmChoice;
  setRhythm: (rhythm: RhythmChoice) => void;
  weekdays: string[];
  toggleWeekday: (day: string) => void;
  everyN: number;
  setEveryN: (value: number) => void;
  everyUnit: 'hour' | 'day' | 'week';
  setEveryUnit: (unit: 'hour' | 'day' | 'week') => void;
  cronExpr: string;
  setCronExpr: (expr: string) => void;
  time: string;
  setTime: (time: string) => void;
}

export function RhythmSection({
  rhythm,
  setRhythm,
  weekdays,
  toggleWeekday,
  everyN,
  setEveryN,
  everyUnit,
  setEveryUnit,
  cronExpr,
  setCronExpr,
  time,
  setTime,
}: RhythmSectionProps) {
  return (
    <>
      <Field label="Rhythm">
        <select
          data-testid="schedule-rhythm"
          value={rhythm}
          onChange={(event) => setRhythm(event.target.value as RhythmChoice)}
          className={INPUT}
        >
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="interval">every N days / weeks / hours</option>
          <option value="cron">custom cron</option>
        </select>
      </Field>

      {rhythm === 'weekly' && (
        <Field label="Weekdays">
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_OPTIONS.map((day) => (
              <button
                key={day.value}
                type="button"
                data-testid={`schedule-weekday-${day.value}`}
                aria-pressed={weekdays.includes(day.value)}
                onClick={() => toggleWeekday(day.value)}
                className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
                  weekdays.includes(day.value)
                    ? 'bg-primary/20 text-primary-light'
                    : 'bg-white/5 text-foreground-muted hover:bg-white/10'
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {rhythm === 'interval' && (
        <Field label="Interval">
          <div className="flex gap-2">
            <input
              data-testid="schedule-every-n"
              type="number"
              min={1}
              value={everyN}
              onChange={(event) => setEveryN(Math.max(1, Number(event.target.value) || 1))}
              className={`${INPUT} w-20`}
            />
            <select
              data-testid="schedule-every-unit"
              value={everyUnit}
              onChange={(event) => setEveryUnit(event.target.value as 'hour' | 'day' | 'week')}
              className={INPUT}
            >
              <option value="hour">hours</option>
              <option value="day">days</option>
              <option value="week">weeks</option>
            </select>
          </div>
        </Field>
      )}

      {rhythm === 'cron' && (
        <Field label="Cron expression">
          <input
            data-testid="schedule-cron"
            value={cronExpr}
            onChange={(event) => setCronExpr(event.target.value)}
            placeholder="0 0 17 * * WED"
            className={`${INPUT} font-mono`}
          />
          <p className="mt-1 text-[9px] text-foreground-muted/60">
            Seconds first. Weekdays as names (MON, WED); numbers count differently here than in
            ordinary cron.
          </p>
        </Field>
      )}

      {(rhythm !== 'interval' || everyUnit !== 'hour') && (
        <Field label="Time">
          <input
            data-testid="schedule-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={`${INPUT} w-32`}
          />
        </Field>
      )}
    </>
  );
}

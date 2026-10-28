'use client';

import { SCHEDULE_VIEWS, type ScheduleView } from '@/lib/notifications/scheduleCalendar';

const LABELS: Record<ScheduleView, string> = {
  list: 'List',
  calendar: 'Calendar',
  timeline: 'Timeline',
};

export interface ScheduleViewSwitchProps {
  value: ScheduleView;
  onChange: (view: ScheduleView) => void;
}

/** Segmented control for how the schedules are shown. Radio semantics: exactly one is on. */
export function ScheduleViewSwitch({ value, onChange }: ScheduleViewSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Schedule view"
      data-testid="schedule-view-switch"
      className="ml-auto flex items-center rounded-lg border border-white/10 p-0.5"
    >
      {SCHEDULE_VIEWS.map((view) => {
        const active = view === value;
        return (
          <button
            key={view}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`schedule-view-${view}`}
            onClick={() => onChange(view)}
            className={`press-feedback rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              active
                ? 'bg-white/10 text-foreground'
                : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
            }`}
          >
            {LABELS[view]}
          </button>
        );
      })}
    </div>
  );
}

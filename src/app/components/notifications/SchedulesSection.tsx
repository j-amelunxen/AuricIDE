'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { formatNotificationProject } from '@/lib/notifications/format';
import { formatNextDue, formatScheduleRhythm } from '@/lib/notifications/scheduleFormat';
import type { Schedule } from '@/lib/tauri/schedules';

export interface SchedulesSectionProps {
  schedules: Schedule[];
  now: number;
  onCreate: () => void;
  onEdit: (schedule: Schedule) => void;
  onToggle: (schedule: Schedule, enabled: boolean) => void;
  onDelete: (schedule: Schedule) => void;
}

/**
 * The saved reminders, above the inbox they feed.
 *
 * Each row answers the two questions a schedule raises — what rhythm, and when
 * next — in words rather than in stored fields. A disabled schedule stays
 * listed and greyed rather than disappearing: a reminder you switched off is
 * still a decision you made, and one you will want to find again.
 */
export function SchedulesSection({
  schedules,
  now,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
}: SchedulesSectionProps) {
  return (
    <div data-testid="schedules-section" className="border-b border-white/5">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
          Schedules
        </h3>
        <button
          data-testid="schedule-create"
          onClick={onCreate}
          title="New schedule"
          aria-label="New schedule"
          className="rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <AuricIcon name="add" className="text-sm" />
        </button>
      </div>

      {schedules.length === 0 ? (
        <p data-testid="schedules-empty" className="px-3 pb-3 text-[11px] text-foreground-muted">
          No schedules. Reminders only fire while AuricIDE is open — missed ones catch up on launch.
        </p>
      ) : (
        <ul className="space-y-1 px-2 pb-2">
          {schedules.map((schedule) => (
            <li
              key={schedule.id}
              data-testid={`schedule-row-${schedule.id}`}
              data-enabled={schedule.enabled}
              className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.04] ${
                schedule.enabled ? '' : 'opacity-50'
              }`}
            >
              <button
                data-testid={`schedule-toggle-${schedule.id}`}
                aria-pressed={schedule.enabled}
                aria-label={schedule.enabled ? 'Turn schedule off' : 'Turn schedule on'}
                onClick={() => onToggle(schedule, !schedule.enabled)}
                className="flex-shrink-0 text-foreground-muted transition-colors hover:text-foreground"
              >
                <AuricIcon
                  name={schedule.enabled ? 'check_circle' : 'radio_button_unchecked'}
                  className={`text-sm ${schedule.enabled ? 'text-[#2effa5]/70' : ''}`}
                />
              </button>

              <button
                onClick={() => onEdit(schedule)}
                className="min-w-0 flex-1 text-left"
                data-testid={`schedule-edit-${schedule.id}`}
              >
                <span className="block truncate text-[11px] font-semibold text-foreground">
                  {schedule.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/60">
                  <span className="truncate">{formatScheduleRhythm(schedule)}</span>
                  <span aria-hidden="true">·</span>
                  <span data-testid={`schedule-next-${schedule.id}`}>
                    {formatNextDue(schedule, now)}
                  </span>
                  {schedule.projectPath !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">
                        {formatNotificationProject(schedule.projectName, schedule.projectPath)}
                      </span>
                    </>
                  )}
                </span>
              </button>

              <button
                data-testid={`schedule-delete-${schedule.id}`}
                aria-label="Delete schedule"
                onClick={() => onDelete(schedule)}
                className="flex-shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-[#ff4a4a]"
              >
                <AuricIcon name="delete" className="text-sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

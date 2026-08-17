'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { formatNotificationAge, formatNotificationProject } from '@/lib/notifications/format';
import { formatNextDue, formatScheduleRhythm } from '@/lib/notifications/scheduleFormat';
import type { Notification } from '@/lib/notifications/types';
import { projectIconFor } from '@/lib/quickAccess/icon';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule } from '@/lib/tauri/schedules';

export interface ScheduleRowProps {
  schedule: Schedule;
  now: number;
  /** Only for the marks pinned projects carry — a schedule is app-global. */
  starredProjects: StarredProject[];
  /**
   * The newest notification this schedule raised, looked up by `dedupeKey`.
   * `undefined` and `null` both mean "nothing found", and the row says so.
   */
  lastRaised?: Notification | null;
  onEdit: (schedule: Schedule) => void;
  onToggle: (schedule: Schedule, enabled: boolean) => void;
  onDelete: (schedule: Schedule) => void;
}

/**
 * One saved reminder.
 *
 * The row answers three questions in words rather than in stored fields: what
 * rhythm, when next, and — the one a stored field cannot answer — whether it
 * has ever actually raised anything. A schedule promising "in 21 d" that has
 * never fired looks exactly like a working one until that last line is there.
 *
 * A disabled schedule stays listed and greyed rather than disappearing: a
 * reminder you switched off is still a decision you made, and one you will
 * want to find again.
 */
export function ScheduleRow({
  schedule,
  now,
  starredProjects,
  lastRaised,
  onEdit,
  onToggle,
  onDelete,
}: ScheduleRowProps) {
  return (
    <li
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
          <span data-testid={`schedule-next-${schedule.id}`}>{formatNextDue(schedule, now)}</span>
          {schedule.projectPath !== null && (
            <>
              <span aria-hidden="true">·</span>
              <ProjectTileFace
                path={schedule.projectPath}
                icon={projectIconFor(starredProjects, schedule.projectPath)}
                size="xs"
                className="flex-shrink-0"
              />
              <span className="truncate">
                {formatNotificationProject(schedule.projectName, schedule.projectPath)}
              </span>
            </>
          )}
          {/* Evidence, next to the promise. What it raised is the better
              evidence, so it leads; the runner's own stamp stands in when a
              run produced nothing, because a run that said nothing still ran
              and "never run" would send you hunting a schedule that works. */}
          <span aria-hidden="true">·</span>
          <span data-testid={`schedule-last-raised-${schedule.id}`} className="truncate">
            {lastRaised
              ? `raised ${formatNotificationAge(lastRaised.createdAt, now)}`
              : schedule.lastFiredAt !== null
                ? `fired ${formatNotificationAge(schedule.lastFiredAt, now)}`
                : 'never run'}
          </span>
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
  );
}

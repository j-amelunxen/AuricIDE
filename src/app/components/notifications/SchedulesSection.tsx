'use client';

import type { Notification } from '@/lib/notifications/types';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule } from '@/lib/tauri/schedules';
import { ScheduleRow } from './ScheduleRow';

export interface SchedulesSectionProps {
  schedules: Schedule[];
  now: number;
  /** Only for the marks pinned projects carry — the list itself is app-global. */
  starredProjects: StarredProject[];
  /** Schedule id → the newest notification it raised. */
  lastRaised?: Map<string, Notification>;
  /**
   * Heading for this run of rows. Set only where several groups are listed
   * under one section ("All"); a single project's triggers are already named
   * by the panel around them.
   */
  label?: string | null;
  onEdit: (schedule: Schedule) => void;
  onToggle: (schedule: Schedule, enabled: boolean) => void;
  onDelete: (schedule: Schedule) => void;
}

/**
 * A run of saved reminders — one project's, or every one there is.
 *
 * Deliberately without a "new schedule" button of its own: the surface around
 * it owns creation, because that button has to know which project the new
 * reminder should be pre-bound to and the list does not.
 */
export function SchedulesSection({
  schedules,
  now,
  starredProjects,
  lastRaised,
  label,
  onEdit,
  onToggle,
  onDelete,
}: SchedulesSectionProps) {
  if (schedules.length === 0) {
    return (
      <p data-testid="schedules-empty" className="px-3 pb-3 text-[11px] text-foreground-muted">
        No schedules. Reminders only fire while AuricIDE is open — missed ones catch up on launch.
      </p>
    );
  }

  return (
    <div
      data-testid={
        label === null || label === undefined ? 'schedules-section' : `schedules-group-${label}`
      }
    >
      {label !== null && label !== undefined && (
        <h4 className="px-3 pt-2 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-muted/60">
          {label}
        </h4>
      )}
      <ul className="space-y-1 px-2 pb-2">
        {schedules.map((schedule) => (
          <ScheduleRow
            key={schedule.id}
            schedule={schedule}
            now={now}
            starredProjects={starredProjects}
            lastRaised={lastRaised?.get(schedule.id) ?? null}
            onEdit={onEdit}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
}

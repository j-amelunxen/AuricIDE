'use client';

import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { formatNotificationProject } from '@/lib/notifications/format';
import { formatNextDue } from '@/lib/notifications/scheduleFormat';
import { projectIconFor } from '@/lib/quickAccess/icon';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule } from '@/lib/tauri/schedules';

export interface UpcomingStripProps {
  /** Already narrowed and ordered by `upcomingSchedules` — rendered as handed. */
  schedules: Schedule[];
  now: number;
  starredProjects: StarredProject[];
  /** `null` selects the app-wide group, a path selects that project. */
  onSelectProject: (projectPath: string | null) => void;
}

/**
 * What fires next, across every project.
 *
 * The one line in the Command Center that ignores the selected project on
 * purpose: "what is about to happen" is a question about the machine, not
 * about whichever project you happen to be looking at. Each chip is a pointer
 * — clicking one moves the rail to the project the reminder belongs to.
 *
 * Absent rather than empty when nothing is due: a band of nothing between the
 * header and the work reads as a failure, not as calm.
 */
export function UpcomingStrip({
  schedules,
  now,
  starredProjects,
  onSelectProject,
}: UpcomingStripProps) {
  if (schedules.length === 0) return null;

  return (
    <div
      data-testid="command-center-upcoming"
      className="flex items-center gap-2 overflow-x-auto border-b border-white/10 px-4 py-2"
    >
      <span className="flex-shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-foreground-muted/50">
        Next up
      </span>
      {schedules.map((schedule) => (
        <button
          key={schedule.id}
          type="button"
          data-testid={`upcoming-${schedule.id}`}
          onClick={() => onSelectProject(schedule.projectPath)}
          className="press-feedback flex flex-shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-foreground-muted hover:border-primary/40 hover:bg-white/[0.07] hover:text-foreground"
        >
          {schedule.projectPath !== null && (
            <ProjectTileFace
              path={schedule.projectPath}
              icon={projectIconFor(starredProjects, schedule.projectPath)}
              size="xs"
              className="flex-shrink-0"
            />
          )}
          <span className="max-w-[160px] truncate font-semibold text-foreground">
            {schedule.name}
          </span>
          {schedule.projectPath !== null && (
            <span className="max-w-[110px] truncate">
              {formatNotificationProject(schedule.projectName, schedule.projectPath)}
            </span>
          )}
          <span aria-hidden="true" className="text-foreground-muted/40">
            ·
          </span>
          <span className="font-mono uppercase tracking-wider text-foreground-muted/70">
            {formatNextDue(schedule, now)}
          </span>
        </button>
      ))}
    </div>
  );
}

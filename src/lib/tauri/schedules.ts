import type { NotificationAction, NotificationSeverity } from '@/lib/notifications/types';
import { invoke } from './invoke';

/** How a schedule repeats. */
export type ScheduleSpecKind = 'cron' | 'every';
export type ScheduleEveryUnit = 'hour' | 'day' | 'week';

/**
 * What happens to occurrences that came due while AuricIDE was closed.
 *
 * `coalesce` is the default because three weeks away should not produce three
 * identical reminders — one that says how overdue it is carries more and costs
 * less attention.
 */
export type ScheduleCatchUp = 'coalesce' | 'skip' | 'all';

/** The notification a schedule raises when it fires. */
export interface SchedulePayload {
  title?: string;
  body?: string;
  severity?: NotificationSeverity;
  actions?: NotificationAction[];
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  projectPath: string | null;
  projectName: string | null;
  specKind: ScheduleSpecKind;
  cronExpr: string | null;
  everyN: number | null;
  everyUnit: ScheduleEveryUnit | null;
  /** First occurrence, UTC `YYYY-MM-DD HH:MM:SS`. Also a floor. */
  anchorAt: string | null;
  /** `HH:MM` in the schedule's own zone. */
  timeOfDay: string | null;
  /** IANA name, stored per schedule so a wall-clock time survives DST. */
  timezone: string;
  catchUp: ScheduleCatchUp;
  /** JSON-encoded `SchedulePayload`. */
  payload: string;
  lastFiredAt: string | null;
  lastCheckedAt: string | null;
  nextDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function schedulesList(): Promise<Schedule[]> {
  return invoke<Schedule[]>('schedules_list');
}

export async function schedulesUpsert(schedule: Schedule): Promise<Schedule> {
  return invoke<Schedule>('schedules_upsert', { schedule });
}

export async function schedulesDelete(id: string): Promise<void> {
  return invoke<void>('schedules_delete', { id });
}

export async function schedulesSetEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke<void>('schedules_set_enabled', { id, enabled });
}

/**
 * The next few occurrences, already formatted in the schedule's own zone.
 * Shown in the editor so a wrong rhythm is caught now rather than in three
 * weeks when the reminder fails to arrive.
 */
export async function schedulesPreview(schedule: Schedule, count = 3): Promise<string[]> {
  return invoke<string[]>('schedules_preview', { schedule, count });
}

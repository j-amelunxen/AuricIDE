import type { NotificationAction, NotificationSeverity } from '@/lib/notifications/types';
import { invoke } from './invoke';

import type {
  ScheduleCatchUp,
  ScheduleEveryUnit,
  ScheduleSpecKind,
} from '@/lib/notifications/scheduleVocabulary';

/** The notification a schedule raises when it fires. */
export interface SchedulePayload {
  title?: string;
  body?: string;
  severity?: NotificationSeverity;
  actions?: NotificationAction[];
}

/**
 * One occurrence that differs from the rhythm: skipped (`movedTo: null`) or
 * moved to another time. Both stamps are UTC `YYYY-MM-DD HH:MM:SS`;
 * `originalAt` is the occurrence the rhythm itself would have produced.
 */
export interface ScheduleException {
  originalAt: string;
  movedTo: string | null;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  projectPath: string | null;
  projectName: string | null;
  /** Mission scaffold this recurrence runs. Absent on legacy schedules. */
  missionSlug?: string | null;
  specKind: ScheduleSpecKind;
  cronExpr: string | null;
  everyN: number | null;
  everyUnit: ScheduleEveryUnit | null;
  /** First occurrence, UTC `YYYY-MM-DD HH:MM:SS`. Also a floor. */
  anchorAt: string | null;
  /** `HH:MM` in the schedule's own zone. */
  timeOfDay: string | null;
  /** Single occurrences moved or skipped. Absent on schedules from before they existed. */
  exceptions?: ScheduleException[];
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

/** One schedule's occurrences inside a window — see `schedules_occurrences`. */
export interface ScheduleOccurrences {
  scheduleId: string;
  /** UTC `YYYY-MM-DD HH:MM:SS`, oldest first. */
  at: string[];
  /** More occurrences exist in the window than `at` holds. */
  truncated: boolean;
}

/**
 * Every occurrence of the given schedules in `(from, to]`, computed by the
 * same engine the runner uses, so a view cannot show a run that will not
 * happen. `from` and `to` are UTC `YYYY-MM-DD HH:MM:SS`.
 */
export async function schedulesOccurrences(
  schedules: Schedule[],
  from: string,
  to: string,
  perScheduleCap?: number
): Promise<ScheduleOccurrences[]> {
  return invoke<ScheduleOccurrences[]>('schedules_occurrences', {
    schedules,
    from,
    to,
    perScheduleCap,
  });
}

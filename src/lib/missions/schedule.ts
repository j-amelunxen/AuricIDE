import type { CreatedMission } from '@/lib/tauri/missions';
import type { Schedule } from '@/lib/tauri/schedules';

export type MissionRecurrence =
  | { kind: 'daily'; timeOfDay: string }
  | { kind: 'weekly'; weekday: number; timeOfDay: string }
  | { kind: 'interval'; everyN: number; everyUnit: 'hour' | 'day' | 'week'; timeOfDay?: string };

export interface BuildMissionScheduleInput {
  mission: CreatedMission;
  projectPath: string;
  projectName: string | null;
  recurrence: MissionRecurrence;
  timezone: string;
  now?: Date;
}

function timestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function buildMissionSchedule({
  mission,
  projectPath,
  projectName,
  recurrence,
  timezone,
  now = new Date(),
}: BuildMissionScheduleInput): Schedule {
  const createdAt = timestamp(now);
  const common = {
    id: mission.scheduleId,
    name: mission.name,
    enabled: true,
    projectPath,
    projectName,
    missionSlug: mission.slug,
    timezone,
    catchUp: 'coalesce' as const,
    // Mission launch authority is synthesized by Rust from missionSlug.
    payload: JSON.stringify({ title: mission.name }),
    lastFiredAt: null,
    lastCheckedAt: createdAt,
    nextDueAt: null,
    createdAt,
    updatedAt: createdAt,
  };

  if (recurrence.kind === 'interval') {
    return {
      ...common,
      specKind: 'every',
      cronExpr: null,
      everyN: Math.max(1, Math.trunc(recurrence.everyN)),
      everyUnit: recurrence.everyUnit,
      anchorAt: createdAt,
      timeOfDay: recurrence.everyUnit === 'hour' ? null : (recurrence.timeOfDay ?? '09:00'),
    };
  }

  const [hour, minute] = recurrence.timeOfDay.split(':').map(Number);
  const day = recurrence.kind === 'weekly' ? String(recurrence.weekday) : '*';
  return {
    ...common,
    specKind: 'cron',
    cronExpr: `0 ${minute} ${hour} * * ${day}`,
    everyN: null,
    everyUnit: null,
    anchorAt: null,
    timeOfDay: recurrence.timeOfDay,
  };
}

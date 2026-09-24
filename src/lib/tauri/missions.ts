import { invoke } from './invoke';
import type { MissionRecurrence } from '@/lib/missions/schedule';
import type { Schedule } from './schedules';

export interface CreateMissionInput {
  projectPath: string;
  projectName: string | null;
  name: string;
  objective: string;
  recurrence: MissionRecurrence;
  timezone: string;
}

export interface CreatedMission {
  name: string;
  slug: string;
  path: string;
  scheduleId: string;
}

export interface CreatedMissionWithSchedule {
  mission: CreatedMission;
  schedule: Schedule;
}

export async function missionCreate(
  input: CreateMissionInput
): Promise<CreatedMissionWithSchedule> {
  return invoke<CreatedMissionWithSchedule>('mission_create', { input });
}

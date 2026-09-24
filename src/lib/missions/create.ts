import {
  missionCreate,
  type CreateMissionInput,
  type CreatedMissionWithSchedule,
} from '@/lib/tauri/missions';

export type CreateMissionWithScheduleInput = CreateMissionInput;

/** Stable orchestration seam used by the dialog and native vertical tests. */
export async function createMissionWithSchedule(
  input: CreateMissionWithScheduleInput,
  deps: {
    create?: typeof missionCreate;
  } = {}
): Promise<CreatedMissionWithSchedule> {
  // One native command owns compensation. A rejected promise therefore means
  // neither a fresh scaffold nor a linked schedule was left behind.
  return (deps.create ?? missionCreate)(input);
}

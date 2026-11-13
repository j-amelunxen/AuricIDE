export type MissionRecurrence =
  | { kind: 'daily'; timeOfDay: string }
  | { kind: 'weekly'; weekday: number; timeOfDay: string }
  | { kind: 'interval'; everyN: number; everyUnit: 'hour' | 'day' | 'week'; timeOfDay?: string };

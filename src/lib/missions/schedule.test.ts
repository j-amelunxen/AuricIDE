import { describe, expect, it, vi } from 'vitest';
import { createMissionWithSchedule } from './create';
import { buildMissionSchedule } from './schedule';

const mission = {
  name: 'Weekly review',
  slug: 'weekly-review',
  path: '/repo/.auric/missions/weekly-review',
  scheduleId: 'mission:abc:weekly-review',
};

describe('mission schedule', () => {
  it('links a coalescing recurrence without storing an editable agent action', () => {
    const schedule = buildMissionSchedule({
      mission,
      projectPath: '/repo',
      projectName: 'repo',
      recurrence: { kind: 'weekly', weekday: 3, timeOfDay: '09:15' },
      timezone: 'Europe/Berlin',
      now: new Date('2026-09-24T07:00:00Z'),
    });
    expect(schedule).toMatchObject({
      id: mission.scheduleId,
      missionSlug: 'weekly-review',
      specKind: 'cron',
      cronExpr: '0 15 9 * * 3',
      catchUp: 'coalesce',
    });
    expect(JSON.parse(schedule.payload)).not.toHaveProperty('actions');
  });

  it('delegates scaffold and schedule coordination to one native command', async () => {
    const schedule = buildMissionSchedule({
      mission,
      projectPath: '/repo',
      projectName: 'repo',
      recurrence: { kind: 'daily', timeOfDay: '09:00' },
      timezone: 'UTC',
      now: new Date('2026-09-24T07:00:00Z'),
    });
    const create = vi.fn(async () => ({ mission, schedule }));
    const result = await createMissionWithSchedule(
      {
        projectPath: '/repo',
        projectName: 'repo',
        name: mission.name,
        objective: 'Review signals',
        recurrence: { kind: 'daily', timeOfDay: '09:00' },
        timezone: 'UTC',
      },
      { create }
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.schedule.missionSlug).toBe(mission.slug);
  });
});

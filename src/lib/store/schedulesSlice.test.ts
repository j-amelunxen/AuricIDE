import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand';
import type { Schedule } from '@/lib/tauri/schedules';

const mockList = vi.fn();
const mockUpsert = vi.fn();
const mockDelete = vi.fn();
const mockSetEnabled = vi.fn();

vi.mock('@/lib/tauri/schedules', () => ({
  schedulesList: () => mockList(),
  schedulesUpsert: (schedule: unknown) => mockUpsert(schedule),
  schedulesDelete: (id: string) => mockDelete(id),
  schedulesSetEnabled: (id: string, enabled: boolean) => mockSetEnabled(id, enabled),
}));

import { createSchedulesSlice, type SchedulesSlice } from './schedulesSlice';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Security-Scan',
    enabled: true,
    projectPath: null,
    projectName: null,
    specKind: 'every',
    cronExpr: null,
    everyN: 21,
    everyUnit: 'day',
    anchorAt: '2026-08-12 07:00:00',
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: null,
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

describe('schedulesSlice', () => {
  let store: StoreApi<SchedulesSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockUpsert.mockImplementation(async (schedule: Schedule) => schedule);
    mockDelete.mockResolvedValue(undefined);
    mockSetEnabled.mockResolvedValue(undefined);
    store = createStore<SchedulesSlice>()((...a) => ({ ...createSchedulesSlice(...a) }));
  });

  describe('loadSchedules', () => {
    it('sorts by name', async () => {
      mockList.mockResolvedValueOnce([
        makeSchedule({ id: 'b', name: 'Zebra' }),
        makeSchedule({ id: 'a', name: 'Alpha' }),
      ]);

      await store.getState().loadSchedules();

      expect(store.getState().schedules.map((s) => s.name)).toEqual(['Alpha', 'Zebra']);
    });

    it('records an error status when the backend is unreachable', async () => {
      mockList.mockRejectedValueOnce(new Error('no backend'));
      await store.getState().loadSchedules();
      expect(store.getState().schedulesStatus).toBe('error');
    });
  });

  describe('saveSchedule', () => {
    // The backend owns nextDueAt; a locally guessed date would disagree with
    // what the runner actually does.
    it('keeps the row the backend stored, not the one submitted', async () => {
      mockUpsert.mockResolvedValueOnce(makeSchedule({ nextDueAt: '2026-09-02 07:00:00' }));

      await store.getState().saveSchedule(makeSchedule());

      expect(store.getState().schedules[0].nextDueAt).toBe('2026-09-02 07:00:00');
    });

    it('replaces an existing schedule rather than duplicating it', async () => {
      await store.getState().saveSchedule(makeSchedule({ name: 'Erst' }));
      await store.getState().saveSchedule(makeSchedule({ name: 'Dann' }));

      expect(store.getState().schedules).toHaveLength(1);
      expect(store.getState().schedules[0].name).toBe('Dann');
    });

    it('returns null and flags an error when the write fails', async () => {
      mockUpsert.mockRejectedValueOnce(new Error('no backend'));

      expect(await store.getState().saveSchedule(makeSchedule())).toBeNull();
      expect(store.getState().schedulesStatus).toBe('error');
    });
  });

  describe('deleteSchedule', () => {
    it('removes the schedule', async () => {
      store.setState({ schedules: [makeSchedule()] });

      await store.getState().deleteSchedule('s1');

      expect(store.getState().schedules).toHaveLength(0);
      expect(mockDelete).toHaveBeenCalledWith('s1');
    });

    // Leaving the panel claiming a schedule is gone when it is not would mean
    // silently expecting a reminder that still fires.
    it('puts the schedule back when the delete fails', async () => {
      mockDelete.mockRejectedValueOnce(new Error('no backend'));
      store.setState({ schedules: [makeSchedule()] });

      await store.getState().deleteSchedule('s1');

      expect(store.getState().schedules).toHaveLength(1);
      expect(store.getState().schedulesStatus).toBe('error');
    });
  });

  describe('toggleSchedule', () => {
    it('flips the switch and reloads what the backend recorded', async () => {
      store.setState({ schedules: [makeSchedule()] });
      mockList.mockResolvedValueOnce([
        makeSchedule({ enabled: false, lastCheckedAt: '2026-08-20 07:00:00' }),
      ]);

      await store.getState().toggleSchedule('s1', false);

      expect(mockSetEnabled).toHaveBeenCalledWith('s1', false);
      expect(store.getState().schedules[0].lastCheckedAt).toBe('2026-08-20 07:00:00');
    });

    it('restores the previous state when the toggle fails', async () => {
      mockSetEnabled.mockRejectedValueOnce(new Error('no backend'));
      store.setState({ schedules: [makeSchedule({ enabled: true })] });

      await store.getState().toggleSchedule('s1', false);

      expect(store.getState().schedules[0].enabled).toBe(true);
      expect(store.getState().schedulesStatus).toBe('error');
    });
  });
});

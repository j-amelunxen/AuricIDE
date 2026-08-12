import type { StateCreator } from 'zustand';
import {
  schedulesDelete,
  schedulesList,
  schedulesSetEnabled,
  schedulesUpsert,
  type Schedule,
} from '@/lib/tauri/schedules';

/**
 * The saved reminders.
 *
 * Firing them is the backend's job — a schedule has no event to be driven by,
 * and the catch-up pass has to happen at startup before any panel is mounted.
 * This slice only edits the list and reads back what the runner recorded.
 */
export interface SchedulesSlice {
  schedules: Schedule[];
  schedulesStatus: 'idle' | 'loading' | 'error';

  loadSchedules: () => Promise<void>;
  saveSchedule: (schedule: Schedule) => Promise<Schedule | null>;
  deleteSchedule: (id: string) => Promise<void>;
  toggleSchedule: (id: string, enabled: boolean) => Promise<void>;
}

function byName(a: Schedule, b: Schedule): number {
  return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
}

export const createSchedulesSlice: StateCreator<SchedulesSlice> = (set, get) => ({
  schedules: [],
  schedulesStatus: 'idle',

  loadSchedules: async () => {
    set({ schedulesStatus: 'loading' });
    try {
      const schedules = await schedulesList();
      set({ schedules: [...schedules].sort(byName), schedulesStatus: 'idle' });
    } catch {
      set({ schedulesStatus: 'error' });
    }
  },

  /**
   * Writes a schedule and folds the stored row back in. The backend's version
   * wins: it owns `nextDueAt` and the bookkeeping timestamps, and a locally
   * guessed next date would disagree with the runner.
   */
  saveSchedule: async (schedule) => {
    try {
      const stored = await schedulesUpsert(schedule);
      const others = get().schedules.filter((s) => s.id !== stored.id);
      set({ schedules: [...others, stored].sort(byName) });
      return stored;
    } catch {
      set({ schedulesStatus: 'error' });
      return null;
    }
  },

  deleteSchedule: async (id) => {
    const previous = get().schedules;
    set({ schedules: previous.filter((s) => s.id !== id) });
    try {
      await schedulesDelete(id);
    } catch {
      // Put it back rather than leaving the panel claiming it is gone.
      set({ schedules: previous, schedulesStatus: 'error' });
    }
  },

  toggleSchedule: async (id, enabled) => {
    const previous = get().schedules;
    set({ schedules: previous.map((s) => (s.id === id ? { ...s, enabled } : s)) });
    try {
      await schedulesSetEnabled(id, enabled);
      // Re-arming moves the check mark on the backend side, so the stored row
      // is the only honest source for what happens next.
      await get().loadSchedules();
    } catch {
      set({ schedules: previous, schedulesStatus: 'error' });
    }
  },
});

import type { StateCreator } from 'zustand';
import {
  initProjectDb as ipcInitProjectDb,
  closeProjectDb as ipcCloseProjectDb,
} from '../tauri/db';

export interface ProjectDbSlice {
  projectDbInitialized: boolean;
  initProjectDb: (projectPath: string) => Promise<void>;
  closeProjectDb: (projectPath: string) => Promise<void>;
}

export const createProjectDbSlice: StateCreator<ProjectDbSlice> = (set) => ({
  projectDbInitialized: false,

  initProjectDb: async (projectPath) => {
    await ipcInitProjectDb(projectPath);
    set({ projectDbInitialized: true });
  },

  closeProjectDb: async (projectPath) => {
    await ipcCloseProjectDb(projectPath);
    set({ projectDbInitialized: false });
  },
});

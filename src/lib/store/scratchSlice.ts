import type { StateCreator } from 'zustand';
import { getScratchDir } from '@/lib/tauri/scratch';
import { readDirectory } from '@/lib/tauri/fs';
import { compareScratchNames } from '@/lib/scratch/naming';

export interface ScratchFile {
  name: string;
  path: string;
}

export interface ScratchSlice {
  scratchDir: string | null;
  scratches: ScratchFile[];
  scratchStatus: 'idle' | 'loading' | 'error';

  initScratches: () => Promise<void>;
  refreshScratches: () => Promise<void>;
}

// The file watcher only covers the project root, so this list never updates
// itself — every mutation path must call refreshScratches() afterwards.
export const createScratchSlice: StateCreator<ScratchSlice> = (set, get) => ({
  scratchDir: null,
  scratches: [],
  scratchStatus: 'idle',

  initScratches: async () => {
    try {
      const dir = await getScratchDir();
      set({ scratchDir: dir });
    } catch {
      set({ scratchStatus: 'error' });
      return;
    }
    await get().refreshScratches();
  },

  refreshScratches: async () => {
    const dir = get().scratchDir;
    if (!dir) return;
    set({ scratchStatus: 'loading' });
    try {
      const entries = await readDirectory(dir);
      const scratches = entries
        .filter((e) => !e.isDirectory && e.name.endsWith('.md'))
        .map((e) => ({ name: e.name, path: e.path }))
        .sort((a, b) => compareScratchNames(a.name, b.name));
      set({ scratches, scratchStatus: 'idle' });
    } catch {
      set({ scratchStatus: 'error' });
    }
  },
});

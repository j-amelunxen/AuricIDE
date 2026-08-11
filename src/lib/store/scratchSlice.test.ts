import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createScratchSlice, type ScratchSlice } from './scratchSlice';

vi.mock('@/lib/tauri/scratch', () => ({
  getScratchDir: vi.fn(async () => '/data/scratches'),
}));

vi.mock('@/lib/tauri/fs', () => ({
  readDirectory: vi.fn(async () => [
    { name: 'scratch-1.md', path: '/data/scratches/scratch-1.md', isDirectory: false },
    { name: 'scratch-3.md', path: '/data/scratches/scratch-3.md', isDirectory: false },
    { name: 'assets', path: '/data/scratches/assets', isDirectory: true },
    { name: 'notes.txt', path: '/data/scratches/notes.txt', isDirectory: false },
  ]),
}));

import { getScratchDir } from '@/lib/tauri/scratch';
import { readDirectory } from '@/lib/tauri/fs';

function makeStore() {
  return create<ScratchSlice>()((...a) => ({ ...createScratchSlice(...a) }));
}

describe('scratchSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initScratches resolves the dir and loads the list', async () => {
    const store = makeStore();
    await store.getState().initScratches();
    expect(store.getState().scratchDir).toBe('/data/scratches');
    expect(store.getState().scratches.map((s) => s.name)).toEqual(['scratch-3.md', 'scratch-1.md']);
    expect(store.getState().scratchStatus).toBe('idle');
  });

  it('refreshScratches filters out directories and non-markdown files', async () => {
    const store = makeStore();
    await store.getState().initScratches();
    const names = store.getState().scratches.map((s) => s.name);
    expect(names).not.toContain('assets');
    expect(names).not.toContain('notes.txt');
  });

  it('refreshScratches without a known dir is a no-op', async () => {
    const store = makeStore();
    await store.getState().refreshScratches();
    expect(readDirectory).not.toHaveBeenCalled();
    expect(store.getState().scratches).toEqual([]);
  });

  it('marks status as error when the dir cannot be resolved', async () => {
    vi.mocked(getScratchDir).mockRejectedValueOnce(new Error('no app data dir'));
    const store = makeStore();
    await store.getState().initScratches();
    expect(store.getState().scratchStatus).toBe('error');
    expect(store.getState().scratchDir).toBeNull();
  });

  it('marks status as error when listing fails', async () => {
    vi.mocked(readDirectory).mockRejectedValueOnce(new Error('unreadable'));
    const store = makeStore();
    await store.getState().initScratches();
    expect(store.getState().scratchStatus).toBe('error');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ProjectDbSlice } from './projectDbSlice';
import { createProjectDbSlice } from './projectDbSlice';

vi.mock('../tauri/db', () => ({
  initProjectDb: vi.fn(async () => undefined),
  closeProjectDb: vi.fn(async () => undefined),
}));

describe('projectDbSlice', () => {
  let store: StoreApi<ProjectDbSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<ProjectDbSlice>()(createProjectDbSlice);
  });

  it('initializes with projectDbInitialized = false', () => {
    expect(store.getState().projectDbInitialized).toBe(false);
  });

  it('initProjectDb sets projectDbInitialized to true', async () => {
    await store.getState().initProjectDb('/project');
    expect(store.getState().projectDbInitialized).toBe(true);
  });

  it('initProjectDb calls IPC initProjectDb', async () => {
    const { initProjectDb } = await import('../tauri/db');
    await store.getState().initProjectDb('/project');
    expect(initProjectDb).toHaveBeenCalledWith('/project');
  });

  it('closeProjectDb resets projectDbInitialized to false', async () => {
    await store.getState().initProjectDb('/project');
    expect(store.getState().projectDbInitialized).toBe(true);

    await store.getState().closeProjectDb('/project');
    expect(store.getState().projectDbInitialized).toBe(false);
  });

  it('closeProjectDb calls IPC closeProjectDb', async () => {
    const { closeProjectDb } = await import('../tauri/db');
    await store.getState().closeProjectDb('/project');
    expect(closeProjectDb).toHaveBeenCalledWith('/project');
  });
});

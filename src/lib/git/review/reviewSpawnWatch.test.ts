import { describe, expect, it, vi } from 'vitest';
import { watchReviewSpawn, type SpawnWatchState } from './reviewSpawnWatch';

function fakeStore(initial: SpawnWatchState) {
  let state = initial;
  const listeners = new Set<(s: SpawnWatchState) => void>();
  return {
    getState: () => state,
    subscribe: (listener: (s: SpawnWatchState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: Partial<SpawnWatchState>) {
      state = { ...state, ...next };
      for (const listener of [...listeners]) listener(state);
    },
    listenerCount: () => listeners.size,
  };
}

const CHECKLIST = '1. `a.ts:3` (new file)\n   Comment: rename it';
const running = { id: 'a1', currentTask: 'older work' };

describe('watchReviewSpawn', () => {
  it('reports a launch when the dialog closes with an agent that carries the checklist', () => {
    const store = fakeStore({ spawnDialogOpen: true, agents: [running] });
    const onLaunched = vi.fn();
    watchReviewSpawn(store, CHECKLIST, onLaunched);
    store.set({
      agents: [running, { id: 'a2', currentTask: `Work through these:\n\n${CHECKLIST}` }],
    });
    expect(onLaunched).not.toHaveBeenCalled();
    store.set({ spawnDialogOpen: false });
    expect(onLaunched).toHaveBeenCalledTimes(1);
    expect(store.listenerCount()).toBe(0);
  });

  it('reports nothing when the dialog is cancelled', () => {
    const store = fakeStore({ spawnDialogOpen: true, agents: [running] });
    const onLaunched = vi.fn();
    watchReviewSpawn(store, CHECKLIST, onLaunched);
    store.set({ spawnDialogOpen: false });
    expect(onLaunched).not.toHaveBeenCalled();
    expect(store.listenerCount()).toBe(0);
  });

  it('ignores another agent that happened to start meanwhile', () => {
    const store = fakeStore({ spawnDialogOpen: true, agents: [] });
    const onLaunched = vi.fn();
    watchReviewSpawn(store, CHECKLIST, onLaunched);
    store.set({ agents: [{ id: 'c1', currentTask: 'Implement ticket 42' }, { id: 'c2' }] });
    store.set({ spawnDialogOpen: false });
    expect(onLaunched).not.toHaveBeenCalled();
  });

  it('does not count an agent that was already running with the same task', () => {
    const store = fakeStore({
      spawnDialogOpen: true,
      agents: [{ id: 'old', currentTask: CHECKLIST }],
    });
    const onLaunched = vi.fn();
    watchReviewSpawn(store, CHECKLIST, onLaunched);
    store.set({ spawnDialogOpen: false });
    expect(onLaunched).not.toHaveBeenCalled();
  });

  it('stops at once when the dialog never opened or there is nothing to match', () => {
    const closed = fakeStore({ spawnDialogOpen: false, agents: [] });
    watchReviewSpawn(closed, CHECKLIST, vi.fn());
    expect(closed.listenerCount()).toBe(0);
    const empty = fakeStore({ spawnDialogOpen: true, agents: [] });
    watchReviewSpawn(empty, '  ', vi.fn());
    expect(empty.listenerCount()).toBe(0);
  });

  it('can be cancelled by the caller', () => {
    const store = fakeStore({ spawnDialogOpen: true, agents: [] });
    const onLaunched = vi.fn();
    const stop = watchReviewSpawn(store, CHECKLIST, onLaunched);
    stop();
    store.set({ agents: [{ id: 'x', currentTask: CHECKLIST }], spawnDialogOpen: false });
    expect(onLaunched).not.toHaveBeenCalled();
  });
});

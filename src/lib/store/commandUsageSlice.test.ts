import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import {
  createCommandUsageSlice,
  MAX_RECENT_COMMANDS,
  type CommandUsageSlice,
} from './commandUsageSlice';

const STORAGE_KEY = 'auric-recent-commands';

function makeStore() {
  return create<CommandUsageSlice>()((...a) => ({ ...createCommandUsageSlice(...a) }));
}

describe('commandUsageSlice', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with no recent commands', () => {
    expect(makeStore().getState().recentCommandIds).toEqual([]);
  });

  it('records a used command', () => {
    const store = makeStore();
    store.getState().recordCommandUse('file.save');
    expect(store.getState().recentCommandIds).toEqual(['file.save']);
  });

  it('puts the most recently used command first', () => {
    const store = makeStore();
    store.getState().recordCommandUse('file.save');
    store.getState().recordCommandUse('git.commit');
    expect(store.getState().recentCommandIds).toEqual(['git.commit', 'file.save']);
  });

  it('moves a repeated command back to the front without duplicating it', () => {
    const store = makeStore();
    store.getState().recordCommandUse('file.save');
    store.getState().recordCommandUse('git.commit');
    store.getState().recordCommandUse('file.save');
    expect(store.getState().recentCommandIds).toEqual(['file.save', 'git.commit']);
  });

  it('caps the list at MAX_RECENT_COMMANDS', () => {
    const store = makeStore();
    for (let i = 0; i < MAX_RECENT_COMMANDS + 5; i++) {
      store.getState().recordCommandUse(`cmd.${i}`);
    }
    expect(store.getState().recentCommandIds).toHaveLength(MAX_RECENT_COMMANDS);
    expect(store.getState().recentCommandIds[0]).toBe(`cmd.${MAX_RECENT_COMMANDS + 4}`);
  });

  it('ignores an empty command id', () => {
    const store = makeStore();
    store.getState().recordCommandUse('');
    expect(store.getState().recentCommandIds).toEqual([]);
  });

  it('persists to localStorage', () => {
    const store = makeStore();
    store.getState().recordCommandUse('file.save');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['file.save']);
  });

  it('loads persisted commands', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['git.commit', 'file.save']));
    const store = makeStore();
    store.getState().loadRecentCommands();
    expect(store.getState().recentCommandIds).toEqual(['git.commit', 'file.save']);
  });

  it('keeps an empty list when persisted data is corrupted', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const store = makeStore();
    store.getState().loadRecentCommands();
    expect(store.getState().recentCommandIds).toEqual([]);
  });

  it('ignores persisted data that is not an array of strings', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'file.save' }, 42]));
    const store = makeStore();
    store.getState().loadRecentCommands();
    expect(store.getState().recentCommandIds).toEqual([]);
  });

  it('survives a failing localStorage write', () => {
    const store = makeStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => store.getState().recordCommandUse('file.save')).not.toThrow();
    expect(store.getState().recentCommandIds).toEqual(['file.save']);
  });
});

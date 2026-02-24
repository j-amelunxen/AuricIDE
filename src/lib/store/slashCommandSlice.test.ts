import { describe, expect, it, beforeEach } from 'vitest';
import type { SlashCommandSlice } from './slashCommandSlice';
import { createSlashCommandSlice } from './slashCommandSlice';
import { create } from 'zustand';

const STORAGE_KEY = 'auric-custom-slash-commands';

function createTestStore() {
  return create<SlashCommandSlice>()((...a) => createSlashCommandSlice(...a));
}

describe('slashCommandSlice', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty array', () => {
    const store = createTestStore();
    expect(store.getState().customSlashCommands).toEqual([]);
  });

  it('adds a custom slash command', () => {
    const store = createTestStore();
    store.getState().addCustomSlashCommand({
      trigger: 'myblock',
      label: 'My Block',
      template: '### My Block',
    });
    expect(store.getState().customSlashCommands).toHaveLength(1);
    expect(store.getState().customSlashCommands[0].trigger).toBe('myblock');
  });

  it('removes a custom slash command by trigger', () => {
    const store = createTestStore();
    store.getState().addCustomSlashCommand({
      trigger: 'myblock',
      label: 'My Block',
      template: '### My Block',
    });
    store.getState().removeCustomSlashCommand('myblock');
    expect(store.getState().customSlashCommands).toHaveLength(0);
  });

  it('persists to localStorage on add', () => {
    const store = createTestStore();
    store.getState().addCustomSlashCommand({
      trigger: 'myblock',
      label: 'My Block',
      template: '### My Block',
    });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trigger).toBe('myblock');
  });

  it('persists to localStorage on remove', () => {
    const store = createTestStore();
    store.getState().addCustomSlashCommand({
      trigger: 'a',
      label: 'A',
      template: 'a',
    });
    store.getState().addCustomSlashCommand({
      trigger: 'b',
      label: 'B',
      template: 'b',
    });
    store.getState().removeCustomSlashCommand('a');
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trigger).toBe('b');
  });

  it('loads from localStorage', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ trigger: 'saved', label: 'Saved', template: 'saved' }])
    );
    const store = createTestStore();
    store.getState().loadCustomSlashCommands();
    expect(store.getState().customSlashCommands).toHaveLength(1);
    expect(store.getState().customSlashCommands[0].trigger).toBe('saved');
  });

  it('stays empty on corrupt localStorage data', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json array');
    const store = createTestStore();
    store.getState().loadCustomSlashCommands();
    expect(store.getState().customSlashCommands).toEqual([]);
  });

  it('does not add duplicate triggers', () => {
    const store = createTestStore();
    store.getState().addCustomSlashCommand({
      trigger: 'dup',
      label: 'First',
      template: 'first',
    });
    store.getState().addCustomSlashCommand({
      trigger: 'dup',
      label: 'Second',
      template: 'second',
    });
    expect(store.getState().customSlashCommands).toHaveLength(1);
    expect(store.getState().customSlashCommands[0].label).toBe('Second');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSpawnDefaults,
  mergeSpawnPreset,
  saveSpawnDefaults,
  SPAWN_DEFAULTS_KEY,
  type SpawnDefaults,
} from './spawnDefaults';

describe('spawn defaults', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips the choices of the last launch', () => {
    saveSpawnDefaults({
      providerId: 'claude',
      model: 'claude-opus-4-6',
      permissionMode: 'acceptEdits',
      headless: true,
    });
    expect(loadSpawnDefaults()).toEqual({
      providerId: 'claude',
      model: 'claude-opus-4-6',
      permissionMode: 'acceptEdits',
      headless: true,
    });
  });

  it('round-trips Crush yolo as a remembered permission mode', () => {
    saveSpawnDefaults({
      providerId: 'crush',
      model: 'auto',
      permissionMode: 'yolo',
      headless: false,
    });
    expect(loadSpawnDefaults()).toEqual({
      providerId: 'crush',
      model: 'auto',
      permissionMode: 'yolo',
      headless: false,
    });
  });

  it('returns null when nothing was saved yet', () => {
    expect(loadSpawnDefaults()).toBeNull();
  });

  it('shrugs off a corrupt entry instead of crashing the dialog', () => {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, '{not json');
    expect(loadSpawnDefaults()).toBeNull();
  });

  it('rejects an entry that lost its shape', () => {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, JSON.stringify({ providerId: 42 }));
    expect(loadSpawnDefaults()).toBeNull();
  });
});

describe('mergeSpawnPreset', () => {
  const saved: SpawnDefaults = {
    providerId: 'claude',
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    headless: true,
  };

  it('leaves the remembered choices alone without a preset', () => {
    expect(mergeSpawnPreset(saved, null)).toEqual(saved);
    expect(mergeSpawnPreset(saved, undefined)).toEqual(saved);
  });

  it('ignores a preset that names no provider', () => {
    expect(mergeSpawnPreset(saved, { model: 'opus' })).toEqual(saved);
  });

  it('lets a full preset win', () => {
    expect(
      mergeSpawnPreset(saved, { providerId: 'crush', model: 'auto', permissionMode: 'plan' })
    ).toEqual({ providerId: 'crush', model: 'auto', permissionMode: 'plan', headless: true });
  });

  it('keeps the remembered model when the preset only pins the same provider', () => {
    expect(mergeSpawnPreset(saved, { providerId: 'claude' })).toEqual(saved);
  });

  // '' matches no model the provider offers, which is exactly the path a
  // retired model name takes — the dialog falls back to the provider default.
  it('hands the dialog a value it will reject when the provider changes', () => {
    const merged = mergeSpawnPreset(saved, { providerId: 'crush' });
    expect(merged).toEqual({
      providerId: 'crush',
      model: '',
      permissionMode: '',
      headless: true,
    });
  });

  it('works with nothing remembered at all', () => {
    expect(mergeSpawnPreset(null, { providerId: 'claude', model: 'opus' })).toEqual({
      providerId: 'claude',
      model: 'opus',
      permissionMode: '',
      headless: false,
    });
  });

  it('never takes headless from a preset', () => {
    expect(mergeSpawnPreset({ ...saved, headless: false }, { providerId: 'crush' })?.headless).toBe(
      false
    );
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { loadSpawnDefaults, saveSpawnDefaults, SPAWN_DEFAULTS_KEY } from './spawnDefaults';

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

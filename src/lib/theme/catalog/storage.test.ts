import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCENT_STORAGE_KEY,
  readStoredThemeId,
  resolveStoredThemeId,
  THEME_STORAGE_KEY,
  writeSnapshot,
  readSnapshot,
  writeStoredThemeId,
} from './storage';
import { BUILTIN_IDS } from './builtins';

describe('theme storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('migrates from legacy accent key when theme is unset', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'cyan');
    expect(readStoredThemeId()).toBe('cyan');
    expect(resolveStoredThemeId(BUILTIN_IDS)).toBe('cyan');
  });

  it('prefers theme over accent', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'cyan');
    localStorage.setItem(THEME_STORAGE_KEY, 'amber');
    expect(readStoredThemeId()).toBe('amber');
  });

  it('mirrors builtins to the legacy accent key', () => {
    writeStoredThemeId('blue');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('blue');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('blue');
  });

  it('does not mirror custom ids onto the accent key', () => {
    writeStoredThemeId('rose');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('rose');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
  });

  it('round-trips a snapshot bag', () => {
    writeSnapshot({ '--primary': '#ff4d6d', '--primary-rgb': '255, 77, 109' });
    expect(readSnapshot()).toEqual({
      '--primary': '#ff4d6d',
      '--primary-rgb': '255, 77, 109',
    });
  });
});

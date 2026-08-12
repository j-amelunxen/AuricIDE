import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSelectedThemeId,
  registerCustomThemeForTests,
  resetThemeForTests,
  selectTheme,
} from './controller';
import { clearThemeOverrides } from './apply';
import { THEME_SCHEMA_VERSION } from './types';
import { THEME_STORAGE_KEY, ACCENT_STORAGE_KEY } from './storage';

describe('selectTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
  });

  afterEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    resetThemeForTests();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
  });

  it('applies a builtin and persists theme + legacy accent', () => {
    expect(selectTheme('blue')).toBe(true);
    expect(getSelectedThemeId()).toBe('blue');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('blue');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('blue');
    expect(document.documentElement.dataset.accent).toBe('blue');
  });

  it('no-ops on unknown ids', () => {
    expect(selectTheme('does-not-exist')).toBe(false);
    expect(getSelectedThemeId()).toBe('purple');
  });

  it('applies a registered custom theme', () => {
    registerCustomThemeForTests({
      schemaVersion: THEME_SCHEMA_VERSION,
      id: 'rose',
      name: 'Rose',
      swatch: '#ff4d6d',
      tokens: { primary: '#ff4d6d' },
    });
    expect(selectTheme('rose')).toBe(true);
    expect(document.documentElement.dataset.auricTheme).toBe('rose');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#ff4d6d');
    // Custom does not mirror onto legacy accent key as a "known accent" for CSS blocks,
    // but storage still writes theme id.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('rose');
  });
});

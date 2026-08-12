import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCENTS,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT_ID,
  accentColor,
  accentRgb,
  applyAccent,
  isAccentId,
  loadAccent,
  saveAccent,
} from './accent';
import { clearThemeOverrides } from './catalog/apply';
import { resetThemeForTests } from './catalog/controller';

describe('accent theme', () => {
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

  it('includes purple as the default and a blue option', () => {
    expect(DEFAULT_ACCENT_ID).toBe('purple');
    expect(ACCENTS.map((a) => a.id)).toContain('purple');
    expect(ACCENTS.map((a) => a.id)).toContain('blue');
  });

  it('validates accent ids', () => {
    expect(isAccentId('blue')).toBe(true);
    expect(isAccentId('chartreuse')).toBe(false);
    expect(isAccentId(undefined)).toBe(false);
    expect(isAccentId(42)).toBe(false);
  });

  it('loadAccent returns the default when nothing is stored', () => {
    expect(loadAccent()).toBe(DEFAULT_ACCENT_ID);
  });

  it('loadAccent ignores an invalid stored value', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'not-a-real-accent');
    expect(loadAccent()).toBe(DEFAULT_ACCENT_ID);
  });

  it('applyAccent stamps the data-accent attribute on <html>', () => {
    applyAccent('blue');
    expect(document.documentElement.dataset.accent).toBe('blue');
  });

  it('applyAccent falls back to default for unknown ids', () => {
    applyAccent('bogus');
    expect(document.documentElement.dataset.accent).toBe(DEFAULT_ACCENT_ID);
  });

  it('saveAccent persists and applies a valid accent', () => {
    saveAccent('cyan');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('cyan');
    expect(localStorage.getItem('auric.theme')).toBe('cyan');
    expect(document.documentElement.dataset.accent).toBe('cyan');
    expect(loadAccent()).toBe('cyan');
  });

  it('saveAccent ignores an unknown accent (no persistence, no apply)', () => {
    saveAccent('rainbow');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });

  describe('runtime color resolution (for xterm / SVG-attribute contexts)', () => {
    afterEach(() => {
      document.documentElement.style.removeProperty('--primary');
      document.documentElement.style.removeProperty('--primary-rgb');
    });

    it('falls back to purple when the variable is unset', () => {
      expect(accentColor()).toBe('#bc13fe');
      expect(accentRgb()).toBe('188, 19, 254');
    });

    it('reads the live CSS variable when set', () => {
      document.documentElement.style.setProperty('--primary', '#2f6bff');
      document.documentElement.style.setProperty('--primary-rgb', '47, 107, 255');
      expect(accentColor()).toBe('#2f6bff');
      expect(accentRgb()).toBe('47, 107, 255');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, clearThemeOverrides } from './apply';
import { getBuiltinTheme } from './builtins';
import { THEME_SCHEMA_VERSION } from './types';
import { THEME_SNAPSHOT_KEY } from './storage';

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
  });

  afterEach(() => {
    localStorage.clear();
    clearThemeOverrides();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.auricTheme;
  });

  it('sets CSS props and data-accent for a builtin', () => {
    const blue = getBuiltinTheme('blue')!;
    applyTheme(blue);
    expect(document.documentElement.dataset.auricTheme).toBe('blue');
    expect(document.documentElement.dataset.accent).toBe('blue');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#2f6bff');
    expect(document.documentElement.style.getPropertyValue('--primary-rgb')).toBe('47, 107, 255');
  });

  it('clears data-accent for custom themes', () => {
    applyTheme({
      schemaVersion: THEME_SCHEMA_VERSION,
      id: 'rose',
      name: 'Rose',
      swatch: '#ff4d6d',
      tokens: { primary: '#ff4d6d' },
      builtin: false,
    });
    expect(document.documentElement.dataset.auricTheme).toBe('rose');
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#ff4d6d');
  });

  it('clears previous overrides when switching', () => {
    applyTheme(getBuiltinTheme('blue')!);
    applyTheme(getBuiltinTheme('cyan')!);
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#13d5fe');
  });

  it('writes a snapshot bag for the boot script', () => {
    applyTheme(getBuiltinTheme('amber')!);
    const raw = localStorage.getItem(THEME_SNAPSHOT_KEY);
    expect(raw).toBeTruthy();
    const bag = JSON.parse(raw!);
    expect(bag['--primary']).toBe('#ffb020');
  });
});

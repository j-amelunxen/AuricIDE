import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyStoredSnapshot, applyTheme, clearThemeOverrides } from './apply';
import { getBuiltinTheme } from './builtins';
import { THEME_SCHEMA_VERSION } from './types';
import { ACCENT_STORAGE_KEY, THEME_SNAPSHOT_KEY, THEME_STORAGE_KEY } from './storage';

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

/**
 * The pre-paint script in the document head reads the snapshot before anything
 * else runs. When the shared preferences arrive after that — the first launch
 * of a build whose origin has never held them — the theme has to be put back on
 * `<html>` by hand, or the window sits there in the default colours until the
 * user opens Appearance.
 */
describe('applyStoredSnapshot', () => {
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

  it('puts the stored snapshot back on the root element', () => {
    localStorage.setItem(THEME_SNAPSHOT_KEY, JSON.stringify({ '--primary': '#ffb020' }));

    applyStoredSnapshot();

    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#ffb020');
  });

  it('stamps the stored theme id so the CSS fallback blocks match', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'amber');
    localStorage.setItem(ACCENT_STORAGE_KEY, 'amber');
    localStorage.setItem(THEME_SNAPSHOT_KEY, JSON.stringify({ '--primary': '#ffb020' }));

    applyStoredSnapshot();

    expect(document.documentElement.dataset.auricTheme).toBe('amber');
    expect(document.documentElement.dataset.accent).toBe('amber');
  });

  /** Re-applying must not rewrite the snapshot it just read. */
  it('leaves the stored snapshot untouched', () => {
    const raw = JSON.stringify({ '--primary': '#ffb020' });
    localStorage.setItem(THEME_SNAPSHOT_KEY, raw);

    applyStoredSnapshot();

    expect(localStorage.getItem(THEME_SNAPSHOT_KEY)).toBe(raw);
  });

  it('does nothing when no snapshot was stored', () => {
    applyStoredSnapshot();

    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
    expect(document.documentElement.dataset.auricTheme).toBeUndefined();
  });
});

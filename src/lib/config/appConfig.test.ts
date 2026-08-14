import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_CONFIG_DEFAULTS,
  APP_CONFIG_KEYS,
  loadAppConfig,
  readAppPref,
  removeAppPref,
  setAppConfigValue,
  writeAppPref,
} from './appConfig';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('app config', () => {
  it('starts from the defaults on a fresh machine', () => {
    expect(loadAppConfig()).toEqual(APP_CONFIG_DEFAULTS);
  });

  it('round-trips each setting', () => {
    setAppConfigValue('enableDeepNlp', true);
    setAppConfigValue('markdownLintEnabled', false);
    setAppConfigValue('mcpAutoStart', true);

    expect(loadAppConfig()).toEqual({
      enableDeepNlp: true,
      markdownLintEnabled: false,
      mcpAutoStart: true,
    });
  });

  it('falls back to the default for a value it did not write', () => {
    localStorage.setItem(APP_CONFIG_KEYS.markdownLintEnabled, 'maybe');

    expect(loadAppConfig().markdownLintEnabled).toBe(APP_CONFIG_DEFAULTS.markdownLintEnabled);
  });

  it('writes under keys the shared-prefs mirror already carries', () => {
    // Anything written to localStorage is mirrored to webview-prefs.json, which
    // is what makes these settings survive the switch between the dev build and
    // the installed app. A key written anywhere else would not.
    setAppConfigValue('mcpAutoStart', true);

    expect(localStorage.getItem(APP_CONFIG_KEYS.mcpAutoStart)).toBe('true');
  });

  it('lists every application-wide key, including ones other modules own', () => {
    // This list is the answer to "what does this app consider global". The
    // theme and the spawn defaults are written elsewhere but belong on it.
    expect(Object.values(APP_CONFIG_KEYS)).toContain('auric.theme');
    expect(Object.values(APP_CONFIG_KEYS)).toContain('auric.agent-spawn-defaults');
    expect(new Set(Object.values(APP_CONFIG_KEYS)).size).toBe(
      Object.values(APP_CONFIG_KEYS).length
    );
  });

  it('does not persist the agent safety switches', () => {
    // Bypass-permissions restored days later is a setting nobody remembers
    // leaving on. It stays session state, so it must have no key here.
    const keys = Object.keys(APP_CONFIG_KEYS);
    expect(keys).not.toContain('dangerouslyIgnorePermissions');
    expect(keys).not.toContain('autoAcceptEdits');
  });
});

describe('preference accessors', () => {
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    expect(readAppPref('anything')).toBeNull();
    expect(() => writeAppPref('anything', 'value')).not.toThrow();
    expect(loadAppConfig()).toEqual(APP_CONFIG_DEFAULTS);
  });

  it('removes a preference', () => {
    writeAppPref('auric.test-key', 'value');
    removeAppPref('auric.test-key');

    expect(readAppPref('auric.test-key')).toBeNull();
  });
});

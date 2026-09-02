import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_LOG_MAX_ROWS,
  AGENT_LOG_RETENTION_DAYS,
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
    setAppConfigValue('cliUsageLimits', true);
    setAppConfigValue('agentTerminalFontSize', 16);
    setAppConfigValue('agentConsoleAutoOpen', true);
    setAppConfigValue('agentLogPersist', true);
    setAppConfigValue('agentLogRetentionDays', 7);

    expect(loadAppConfig()).toEqual({
      enableDeepNlp: true,
      markdownLintEnabled: false,
      mcpAutoStart: true,
      cliUsageLimits: true,
      agentTerminalFontSize: 16,
      agentConsoleAutoOpen: true,
      agentLogPersist: true,
      agentLogRetentionDays: 7,
    });
  });

  it('keeps the Agent Console closed on launch until asked for', () => {
    // Opening it unasked would replace the start screen the moment any agent
    // is running, which is a surprise the first launch must not spring.
    expect(APP_CONFIG_DEFAULTS.agentConsoleAutoOpen).toBe(false);
    expect(loadAppConfig().agentConsoleAutoOpen).toBe(false);
    expect(APP_CONFIG_KEYS.agentConsoleAutoOpen).toBe('auric.agent-console-auto-open');
  });

  it('keeps the CLI quota reader off until it is asked for', () => {
    // Switching it on changes how AuricIDE invokes `claude`, so it must never
    // arrive on by default. Rust reads the same key out of the mirror and
    // applies the same default.
    expect(APP_CONFIG_DEFAULTS.cliUsageLimits).toBe(false);
    expect(loadAppConfig().cliUsageLimits).toBe(false);
    expect(APP_CONFIG_KEYS.cliUsageLimits).toBe('auric.cli-usage-limits');
  });

  it('uses a readable default for agent terminals and persists a chosen size', () => {
    expect(APP_CONFIG_DEFAULTS.agentTerminalFontSize).toBe(14);
    expect(APP_CONFIG_KEYS.agentTerminalFontSize).toBe('auric.agent-terminal-font-size');

    setAppConfigValue('agentTerminalFontSize', 18);

    expect(loadAppConfig().agentTerminalFontSize).toBe(18);
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
    expect(APP_CONFIG_KEYS.pmTicketSort).toBe('auric.pm.ticket-sort');
    expect(APP_CONFIG_KEYS.inboxSort).toBe('auric.inbox.sort');
    expect(APP_CONFIG_KEYS.notificationSoundEnabled).toBe('auric.notifications.sound');
    expect(APP_CONFIG_KEYS.notificationSound).toBe('auric.notifications.sound-id');
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

describe('agent log persistence', () => {
  it('writes nothing to disk until the user asks for it', () => {
    // Opt-in on purpose: a history of agent activity is a file on the user's
    // machine, so an untouched install must keep the feed in memory only.
    expect(APP_CONFIG_DEFAULTS.agentLogPersist).toBe(false);
    expect(loadAppConfig().agentLogPersist).toBe(false);
    expect(APP_CONFIG_KEYS.agentLogPersist).toBe('auric.agent-log.persist');
  });

  it('keeps two days of history when nothing is stored', () => {
    // The empty store reads as Number(null) === 0, which is itself a permitted
    // value ("no age limit") — so an absent key must never decode as one.
    expect(APP_CONFIG_DEFAULTS.agentLogRetentionDays).toBe(2);
    expect(loadAppConfig().agentLogRetentionDays).toBe(2);
    expect(APP_CONFIG_KEYS.agentLogRetentionDays).toBe('auric.agent-log.retention-days');
  });

  it('falls back to two days for a retention span it does not offer', () => {
    localStorage.setItem(APP_CONFIG_KEYS.agentLogRetentionDays, '9000');

    expect(loadAppConfig().agentLogRetentionDays).toBe(2);
  });

  it('falls back to the defaults for values it did not write', () => {
    localStorage.setItem(APP_CONFIG_KEYS.agentLogPersist, 'yes');
    localStorage.setItem(APP_CONFIG_KEYS.agentLogRetentionDays, 'forever');

    expect(loadAppConfig().agentLogPersist).toBe(false);
    expect(loadAppConfig().agentLogRetentionDays).toBe(2);
  });

  it('round-trips every offered retention span, including no age limit', () => {
    expect([...AGENT_LOG_RETENTION_DAYS]).toEqual([2, 7, 30, 0]);

    for (const days of AGENT_LOG_RETENTION_DAYS) {
      setAppConfigValue('agentLogRetentionDays', days);
      expect(loadAppConfig().agentLogRetentionDays).toBe(days);
    }
  });

  it('caps the stored history by row count as well as by age', () => {
    // Zero days means "no age limit", not "keep nothing" — without a row cap
    // that choice would let the file grow without any bound at all.
    expect(AGENT_LOG_MAX_ROWS).toBe(200_000);
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

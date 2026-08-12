import { describe, expect, it } from 'vitest';
import {
  formatNotificationAge,
  formatNotificationProject,
  parseNotificationTimestamp,
  severityTone,
} from './format';

describe('parseNotificationTimestamp', () => {
  // The bug this guards: JS reads a space-separated timestamp as local time,
  // but SQLite wrote it in UTC. In Berlin summer that is two hours of drift,
  // enough to render a fresh row as minted in the future.
  it('reads the SQLite form as UTC', () => {
    const parsed = parseNotificationTimestamp('2026-08-12 10:00:00');
    expect(parsed?.toISOString()).toBe('2026-08-12T10:00:00.000Z');
  });

  it('leaves a full ISO string alone', () => {
    const parsed = parseNotificationTimestamp('2026-08-12T10:00:00.000Z');
    expect(parsed?.toISOString()).toBe('2026-08-12T10:00:00.000Z');
  });

  it('agrees on both forms of the same instant', () => {
    const sqlite = parseNotificationTimestamp('2026-08-12 10:00:00');
    const iso = parseNotificationTimestamp('2026-08-12T10:00:00.000Z');
    expect(sqlite?.getTime()).toBe(iso?.getTime());
  });

  it.each(['', 'not a date', '2026-13-45 99:99:99'])('returns null for %o', (raw) => {
    expect(parseNotificationTimestamp(raw)).toBeNull();
  });
});

describe('formatNotificationAge', () => {
  const at = '2026-08-12 10:00:00';
  const base = Date.parse('2026-08-12T10:00:00.000Z');

  it.each([
    ['jetzt', 0],
    ['jetzt', 59_000],
    ['1m', 60_000],
    ['59m', 59 * 60_000],
    ['1h', 60 * 60_000],
    ['23h', 23 * 60 * 60_000],
    ['1d', 24 * 60 * 60_000],
    ['6d', 6 * 24 * 60 * 60_000],
    ['1w', 7 * 24 * 60 * 60_000],
    ['4w', 30 * 24 * 60 * 60_000],
  ])('renders %s after %dms', (expected, elapsed) => {
    expect(formatNotificationAge(at, base + elapsed)).toBe(expected);
  });

  // Clock skew between the database and the UI must not read as a negative age.
  it('never goes negative for a row from the near future', () => {
    expect(formatNotificationAge(at, base - 5_000)).toBe('jetzt');
  });

  it('renders nothing for an unparseable timestamp', () => {
    expect(formatNotificationAge('garbage', base)).toBe('');
  });
});

describe('formatNotificationProject', () => {
  it('prefers the stored name', () => {
    expect(formatNotificationProject('AuricIDE', '/x/y')).toBe('AuricIDE');
  });

  it('falls back to the last path segment', () => {
    expect(formatNotificationProject(null, '/Users/me/projects/auric')).toBe('auric');
  });

  it('ignores a trailing slash on the path', () => {
    expect(formatNotificationProject(null, '/Users/me/auric/')).toBe('auric');
  });

  it.each([
    [null, null],
    ['', ''],
  ])('calls a project-less row "App" (%o, %o)', (name, path) => {
    expect(formatNotificationProject(name, path)).toBe('App');
  });
});

describe('severityTone', () => {
  it.each(['info', 'success', 'warn', 'error'] as const)('has a tone for %s', (severity) => {
    expect(severityTone(severity).icon).toBeTruthy();
  });

  // A row written by hand or an older client may carry anything.
  it('falls back to info for an unknown severity', () => {
    expect(severityTone('bogus' as never)).toBe(severityTone('info'));
  });
});

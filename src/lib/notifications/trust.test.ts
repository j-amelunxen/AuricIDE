import { describe, expect, it } from 'vitest';
import { notificationTrust } from './trust';

const row = (source: string, dedupeKey: string | null = null) => ({ source, dedupeKey });

describe('notificationTrust', () => {
  // Schedules are the frictionless path: everything in that payload was typed
  // into the schedule editor by the person who will click the button.
  it.each(['system', 'ui'] as const)('trusts a %s payload', (source) => {
    expect(notificationTrust(row(source))).toBe('user');
  });

  it('trusts the reminder of a schedule a person made', () => {
    expect(notificationTrust(row('system', 'schedule:1b2c3d:2026-09-20 08:00:00'))).toBe('user');
    expect(notificationTrust(row('system', 'schedule:mission:ab12:blog:2026-09-20 08:00:00'))).toBe(
      'user'
    );
  });

  // Written by a running model. It may still offer a button; it may not decide
  // how much authority the button hands out.
  it.each(['agent', 'mcp'] as const)('does not trust a %s payload', (source) => {
    expect(notificationTrust(row(source))).toBe('foreign');
  });

  it('does not trust a source it has never heard of', () => {
    expect(notificationTrust(row('something-new'))).toBe('foreign');
  });

  // Sub-goal 09, review r4: an agent's schedule (`mcp-` id) fired as `system`
  // before r4, and an older build sharing the inbox still can.
  it('does not trust the reminder of a schedule an agent created, whatever its source', () => {
    const key = 'schedule:mcp-1727000000000-4242-1:2026-09-20 08:00:00';
    expect(notificationTrust(row('system', key))).toBe('foreign');
    expect(notificationTrust(row('ui', key))).toBe('foreign');
  });

  it('reads the schedule id, not any key that merely starts alike', () => {
    expect(notificationTrust(row('system', 'mcp-not-a-schedule-key'))).toBe('user');
  });
});

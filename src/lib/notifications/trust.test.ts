import { describe, expect, it } from 'vitest';
import { notificationTrust } from './trust';

describe('notificationTrust', () => {
  // Schedules are the frictionless path: everything in that payload was typed
  // into the schedule editor by the person who will click the button.
  it.each(['system', 'ui'] as const)('trusts a %s payload', (source) => {
    expect(notificationTrust(source)).toBe('user');
  });

  // Written by a running model. It may still offer a button; it may not decide
  // how much authority the button hands out.
  it.each(['agent', 'mcp'] as const)('does not trust a %s payload', (source) => {
    expect(notificationTrust(source)).toBe('foreign');
  });

  it('does not trust a source it has never heard of', () => {
    expect(notificationTrust('something-new')).toBe('foreign');
  });
});

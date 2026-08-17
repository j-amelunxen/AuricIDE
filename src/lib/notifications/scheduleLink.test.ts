import { describe, expect, it } from 'vitest';
import fixture from '@/lib/conductor/scheduleDedupeKey.fixtures.json';
import { scheduleIdFromDedupeKey } from './scheduleLink';

describe('scheduleIdFromDedupeKey', () => {
  // The same fixture Rust writes against (schedules.rs) and the conductor
  // reads the occurrence out of. If the key format moves, both ends notice.
  it('reads the id out of the key Rust actually writes', () => {
    expect(scheduleIdFromDedupeKey(fixture.dedupeKey)).toBe(fixture.scheduleId);
  });

  it('has nothing to link when there is no key', () => {
    expect(scheduleIdFromDedupeKey(null)).toBeNull();
  });

  // `origin` carries a schedule's *name*, which the user can rename at any
  // time. Only the key carries the id, so anything else is not a link.
  it('refuses a key that is not a schedule key', () => {
    expect(scheduleIdFromDedupeKey('agent:done:42')).toBeNull();
    expect(scheduleIdFromDedupeKey('schedule:sched-42')).toBeNull();
    expect(scheduleIdFromDedupeKey('Security scan')).toBeNull();
    expect(scheduleIdFromDedupeKey('')).toBeNull();
  });

  it('refuses a key whose occurrence is not a timestamp', () => {
    expect(scheduleIdFromDedupeKey('schedule:sched-42:soon')).toBeNull();
    expect(scheduleIdFromDedupeKey('schedule:sched-42:2026-08-17')).toBeNull();
  });

  it('keeps an id that contains a colon', () => {
    expect(scheduleIdFromDedupeKey('schedule:team:nightly:2026-08-17 15:00:00')).toBe(
      'team:nightly'
    );
  });
});

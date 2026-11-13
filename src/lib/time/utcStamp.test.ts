import { describe, expect, it } from 'vitest';
import { formatUtcStamp, parseUtcDate, parseUtcStamp } from './utcStamp';

describe('UTC stamps', () => {
  const ms = Date.UTC(2026, 10, 13, 9, 30, 5);

  it('writes the SQLite shape in UTC and reads it back as UTC', () => {
    expect(formatUtcStamp(ms)).toBe('2026-11-13 09:30:05');
    expect(parseUtcStamp('2026-11-13 09:30:05')).toBe(ms);
  });

  it('reads a zone-less ISO form as UTC too, and a zoned one as given', () => {
    expect(parseUtcStamp('2026-11-13T09:30:05')).toBe(ms);
    expect(parseUtcStamp('2026-11-13T10:30:05+01:00')).toBe(ms);
    expect(parseUtcDate('2026-11-13T09:30:05.000Z')?.getTime()).toBe(ms);
  });

  it('gives null for anything it cannot read', () => {
    expect(parseUtcStamp('yesterday')).toBeNull();
    expect(parseUtcStamp('')).toBeNull();
    expect(parseUtcStamp(null)).toBeNull();
  });
});

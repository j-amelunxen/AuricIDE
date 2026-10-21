import { describe, expect, it } from 'vitest';
import { absoluteDate, relativeDate } from './graphDates';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const ago = (seconds: number) => NOW / 1000 - seconds;

describe('relativeDate', () => {
  it('says now for the last minute', () => {
    expect(relativeDate(ago(20), NOW)).toBe('now');
  });
  it('counts minutes, hours and days', () => {
    expect(relativeDate(ago(5 * 60), NOW)).toBe('5 min ago');
    expect(relativeDate(ago(3 * 3600), NOW)).toBe('3 h ago');
    expect(relativeDate(ago(3 * 86400), NOW)).toBe('3 d ago');
  });
  it('names yesterday', () => {
    expect(relativeDate(ago(30 * 3600), NOW)).toBe('Yesterday');
  });
  it('falls back to a calendar date after a month, with the year once it is not this one', () => {
    expect(relativeDate(ago(60 * 86400), NOW, 'UTC')).toBe('Aug 22');
    expect(relativeDate(ago(400 * 86400), NOW, 'UTC')).toBe('Sep 16, 2025');
  });
  it('treats a commit from the future as now', () => {
    expect(relativeDate(ago(-3600), NOW)).toBe('now');
  });
});

describe('absoluteDate', () => {
  it('gives a full date and time for the hover title', () => {
    expect(absoluteDate(Date.UTC(2026, 9, 21, 12, 30) / 1000, 'UTC')).toBe(
      'Oct 21, 2026, 12:30 PM'
    );
  });
});

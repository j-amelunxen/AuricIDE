import { describe, expect, it } from 'vitest';
import { formatSessionAge } from './sessionAge';

describe('formatSessionAge', () => {
  it.each([
    [30_000, '30s ago'],
    [5 * 60_000, '5m ago'],
    [3 * 3600_000, '3h ago'],
    [3 * 3600_000 + 20 * 60_000, '3h 20m ago'],
    [2 * 86_400_000, '2d ago'],
    [2 * 86_400_000 + 5 * 3600_000, '2d 5h ago'],
  ])('%i ms reads %s', (ms, expected) => {
    expect(formatSessionAge(ms)).toBe(expected);
  });
});

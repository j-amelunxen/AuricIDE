import { describe, expect, it } from 'vitest';
import { formatInboxDueDate, isDueDateOverdue, isValidDueDate, normalizeDueDate } from './dueDate';

describe('isValidDueDate', () => {
  it('accepts a real calendar date', () => {
    expect(isValidDueDate('2026-08-20')).toBe(true);
  });

  it('rejects the wrong shape', () => {
    expect(isValidDueDate('20.08.2026')).toBe(false);
    expect(isValidDueDate('2026-8-20')).toBe(false);
    expect(isValidDueDate('')).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    expect(isValidDueDate('2026-02-31')).toBe(false);
    expect(isValidDueDate('2026-13-01')).toBe(false);
  });
});

describe('normalizeDueDate', () => {
  it('turns blank values into null', () => {
    expect(normalizeDueDate(null)).toBeNull();
    expect(normalizeDueDate('')).toBeNull();
    expect(normalizeDueDate('   ')).toBeNull();
  });

  it('returns a valid date unchanged', () => {
    expect(normalizeDueDate('2026-08-20')).toBe('2026-08-20');
  });

  it('returns null for an invalid date instead of storing it', () => {
    expect(normalizeDueDate('nope')).toBeNull();
  });
});

describe('isDueDateOverdue', () => {
  const noonOnAug18 = Date.UTC(2026, 7, 18, 12, 0, 0);

  it('is overdue when the date is before today', () => {
    expect(isDueDateOverdue('2026-08-17', noonOnAug18)).toBe(true);
  });

  it('is not overdue on the due day itself', () => {
    expect(isDueDateOverdue('2026-08-18', noonOnAug18)).toBe(false);
  });

  it('is not overdue without a date', () => {
    expect(isDueDateOverdue(null, noonOnAug18)).toBe(false);
  });
});

describe('formatInboxDueDate', () => {
  it('renders a compact month-and-day label', () => {
    expect(formatInboxDueDate('2026-08-20')).toBe('20 Aug');
  });
});

import { describe, expect, it } from 'vitest';
import { ticketStatusChoices, ticketStatusChipLabel } from './ticketStatusMenu';

describe('ticketStatusChoices', () => {
  it('offers every ticket status and marks the current one', () => {
    const choices = ticketStatusChoices('open');
    expect(choices.map((choice) => choice.status)).toEqual([
      'open',
      'in_progress',
      'to_test',
      'in_review',
      'done',
      'archived',
      'discarded',
    ]);
    expect(choices.find((choice) => choice.status === 'open')?.selected).toBe(true);
    expect(choices.find((choice) => choice.status === 'done')?.selected).toBe(false);
  });

  it('selects nothing when the current status is unknown', () => {
    expect(ticketStatusChoices('unknown').every((choice) => !choice.selected)).toBe(true);
  });
});

describe('ticketStatusChipLabel', () => {
  it('uses the compact chip label for a known status', () => {
    expect(ticketStatusChipLabel('in_progress')).toBe('IP');
    expect(ticketStatusChipLabel('open')).toBe('Open');
  });

  it('falls back to Unknown for anything else', () => {
    expect(ticketStatusChipLabel('unknown')).toBe('Unknown');
  });
});

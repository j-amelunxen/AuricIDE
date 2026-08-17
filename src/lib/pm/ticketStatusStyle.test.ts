import { describe, expect, it } from 'vitest';
import { TICKET_STATUSES } from './enums';
import {
  TICKET_STATUS_BADGE_CLASS,
  TICKET_STATUS_DOT_CLASS,
  TICKET_STATUS_LABEL,
} from './ticketStatusStyle';

/**
 * The ticket board and the inbox both draw a status chip; this is the one
 * palette that decides what each status looks like, so the two can never
 * disagree about what "in review" means.
 */
describe('ticket status style', () => {
  it('has a label, a badge class and a dot class for every ticket status', () => {
    for (const status of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABEL[status]).toBeTruthy();
      expect(TICKET_STATUS_BADGE_CLASS[status]).toBeTruthy();
      expect(TICKET_STATUS_DOT_CLASS[status]).toBeTruthy();
    }
  });

  it('gives review its own indigo tone, distinct from open/progress/done', () => {
    expect(TICKET_STATUS_BADGE_CLASS.in_review).toContain('indigo');
    expect(TICKET_STATUS_BADGE_CLASS.open).not.toContain('indigo');
    expect(TICKET_STATUS_BADGE_CLASS.done).not.toContain('indigo');
  });
});

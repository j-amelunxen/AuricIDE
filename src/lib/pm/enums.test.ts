import { describe, expect, it } from 'vitest';
import {
  GOAL_STATUSES,
  isClosedTicketStatus,
  isHiddenTicketStatus,
  MODEL_POWERS,
  PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  TICKET_STATUSES,
} from './enums';

/**
 * These are contract values, not implementation details: the conductor, the
 * goal satisfaction check and every MCP client agree on them. A change here is
 * a schema change, so it has to be deliberate rather than incidental.
 */
describe('project state vocabulary', () => {
  // 'in_review' is the state the conductor hands a ticket to the judge in:
  // the implementer is finished, the sign-off is not. Dropping it would make
  // work in review look either still-running or already satisfied.
  it('pins the ticket statuses the conductor loop depends on', () => {
    expect([...TICKET_STATUSES]).toEqual([
      'open',
      'in_progress',
      'to_test',
      'in_review',
      'done',
      'archived',
      'discarded',
    ]);
  });

  it('hides discarded the same way archived is hidden from the default board', () => {
    expect(isHiddenTicketStatus('archived')).toBe(true);
    expect(isHiddenTicketStatus('discarded')).toBe(true);
    expect(isHiddenTicketStatus('open')).toBe(false);
    expect(isHiddenTicketStatus('to_test')).toBe(false);
    expect(isHiddenTicketStatus('in_review')).toBe(false);
    expect(isHiddenTicketStatus('done')).toBe(false);
  });

  it('treats discarded as closed work, not leftover obligation', () => {
    expect(isClosedTicketStatus('done')).toBe(true);
    expect(isClosedTicketStatus('archived')).toBe(true);
    expect(isClosedTicketStatus('discarded')).toBe(true);
    expect(isClosedTicketStatus('to_test')).toBe(false);
    expect(isClosedTicketStatus('in_progress')).toBe(false);
  });

  it('pins the priority ladder', () => {
    expect([...PRIORITIES]).toEqual(['low', 'normal', 'high', 'critical']);
  });

  it('pins the goal lifecycle', () => {
    expect([...GOAL_STATUSES]).toEqual([
      'draft',
      'active',
      'in_progress',
      'achieved',
      'failed',
      'archived',
    ]);
  });

  it('pins the requirement lifecycle', () => {
    expect([...REQUIREMENT_STATUSES]).toEqual([
      'draft',
      'active',
      'implemented',
      'verified',
      'deprecated',
    ]);
  });

  it('pins the requirement types', () => {
    expect([...REQUIREMENT_TYPES]).toEqual(['functional', 'non_functional']);
  });

  it('pins the model power levels', () => {
    expect([...MODEL_POWERS]).toEqual(['low', 'medium', 'high']);
  });

  it('keeps every vocabulary free of duplicates', () => {
    for (const values of [
      TICKET_STATUSES,
      PRIORITIES,
      GOAL_STATUSES,
      REQUIREMENT_STATUSES,
      REQUIREMENT_TYPES,
      MODEL_POWERS,
    ]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

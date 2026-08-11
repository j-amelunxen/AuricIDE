import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createEpic } from '../tools/epics';
import { createTicket } from '../tools/tickets';
import { submitTicketReview } from '../tools/reviews';
import { resolveTicketId } from '../tools/resolve';
import { createTestDb } from '../db';

describe('submitTicketReview', () => {
  let db: Database.Database;
  let ticketId: string;

  beforeEach(() => {
    db = createTestDb();
    const epicId = createEpic(db, { name: 'Epic' }).id;
    ticketId = createTicket(db, { epicId, name: 'Ticket' }).id;
  });

  afterEach(() => {
    db.close();
  });

  it('writes a row recording the verdict and reason', () => {
    const review = submitTicketReview(db, {
      ticketId,
      pass: true,
      reason: 'Meets all acceptance criteria',
    });

    expect(review.ticket_id).toBe(ticketId);
    expect(review.verdict).toBe(1);
    expect(review.reason).toBe('Meets all acceptance criteria');
    expect(review.reviewer).toBe('review-agent');

    const stored = db.prepare('SELECT * FROM pm_ticket_reviews WHERE id = ?').get(review.id) as {
      verdict: number;
      ticket_id: string;
    };
    expect(stored.ticket_id).toBe(ticketId);
    expect(stored.verdict).toBe(1);
  });

  it('stores verdict 0 for a rejected review', () => {
    const review = submitTicketReview(db, {
      ticketId,
      pass: false,
      reason: 'Missing test coverage for the error path',
    });

    expect(review.verdict).toBe(0);
  });

  it('rejects an empty reason', () => {
    expect(() => submitTicketReview(db, { ticketId, pass: true, reason: '' })).toThrow(
      /contract violation/
    );
    expect(() => submitTicketReview(db, { ticketId, pass: false, reason: '   ' })).toThrow(
      /contract violation/
    );
    expect(db.prepare('SELECT COUNT(*) AS cnt FROM pm_ticket_reviews').get()).toEqual({ cnt: 0 });
  });

  it('accepts a ticketId prefix, not just the full UUID', () => {
    // Mirrors what the registered submit_ticket_review tool does: resolve the
    // prefix to a full ID via resolveTicketId, then hand the full ID to
    // submitTicketReview.
    const prefix = ticketId.slice(0, 8);
    const resolved = resolveTicketId(db, prefix);
    const review = submitTicketReview(db, { ticketId: resolved, pass: true, reason: 'Looks good' });
    expect(review.ticket_id).toBe(ticketId);
  });
});

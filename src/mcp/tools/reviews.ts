import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import { resolveTicketId } from './resolve';

export interface TicketReviewRow {
  id: string;
  ticket_id: string;
  verdict: number;
  reason: string;
  reviewer: string;
  created_at: string;
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function getReview(db: Database.Database, id: string): TicketReviewRow | undefined {
  return db.prepare('SELECT * FROM pm_ticket_reviews WHERE id = ?').get(id) as
    TicketReviewRow | undefined;
}

/**
 * Records a review agent's verdict on a finished ticket. A reason is
 * mandatory for both a pass and a reject — a verdict with no reason is a
 * contract violation the conductor cannot act on.
 */
export function submitTicketReview(
  db: Database.Database,
  params: { ticketId: string; pass: boolean; reason: string }
): TicketReviewRow {
  if (params.reason.trim().length === 0) {
    throw new Error(
      'A ticket review must include a reason — a verdict with no reason is a contract violation.'
    );
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pm_ticket_reviews (id, ticket_id, verdict, reason, reviewer, created_at)
     VALUES (?, ?, ?, ?, 'review-agent', ?)`
  ).run(id, params.ticketId, params.pass ? 1 : 0, params.reason, now());
  return getReview(db, id)!;
}

export function registerReviewTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'submit_ticket_review',
    description:
      "Record a review agent's verdict on a finished ticket (pass or reject) with a reason. The conductor reads this back once the review agent's process exits.",
    parameters: z.object({
      ticketId: z.string().describe('Ticket ID (UUID or unique prefix)'),
      pass: z.boolean().describe('true if the ticket passes review, false to reject it'),
      reason: z.string().min(1).describe('Why this verdict was reached'),
    }),
    execute: async ({ ticketId, pass, reason }) =>
      JSON.stringify(
        submitTicketReview(db, { ticketId: resolveTicketId(db, ticketId), pass, reason })
      ),
  });
}

import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveGoalId, resolveTicketId } from './resolve';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusHistoryEntry {
  id: string;
  ticket_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  source: string;
}

export interface GoalStatusHistoryEntry {
  id: string;
  goal_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function insertStatusHistory(
  db: Database.Database,
  ticketId: string,
  fromStatus: string | null,
  toStatus: string,
  source: string
): void {
  db.prepare(
    `INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`
  ).run(crypto.randomUUID(), ticketId, fromStatus, toStatus, source);
}

export function listStatusHistory(db: Database.Database, ticketId?: string): StatusHistoryEntry[] {
  if (ticketId) {
    return db
      .prepare('SELECT * FROM pm_status_history WHERE ticket_id = ? ORDER BY changed_at ASC')
      .all(ticketId) as StatusHistoryEntry[];
  }
  return db
    .prepare('SELECT * FROM pm_status_history ORDER BY changed_at ASC')
    .all() as StatusHistoryEntry[];
}

/**
 * Goal twin of `insertStatusHistory`. Callers write it only when the status
 * really changed (or the goal was created, `fromStatus` null) — an unchanged
 * status is not an event.
 */
export function insertGoalStatusHistory(
  db: Database.Database,
  goalId: string,
  fromStatus: string | null,
  toStatus: string,
  source: string
): void {
  db.prepare(
    `INSERT INTO pm_goal_status_history (id, goal_id, from_status, to_status, changed_at, source)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`
  ).run(crypto.randomUUID(), goalId, fromStatus, toStatus, source);
}

export function listGoalStatusHistory(
  db: Database.Database,
  goalId?: string
): GoalStatusHistoryEntry[] {
  // rowid breaks ties: two changes within one second keep their order.
  if (goalId) {
    return db
      .prepare(
        'SELECT * FROM pm_goal_status_history WHERE goal_id = ? ORDER BY changed_at ASC, rowid ASC'
      )
      .all(goalId) as GoalStatusHistoryEntry[];
  }
  return db
    .prepare('SELECT * FROM pm_goal_status_history ORDER BY changed_at ASC, rowid ASC')
    .all() as GoalStatusHistoryEntry[];
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerHistoryTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_status_history',
    description: 'List status change history for all tickets or a specific ticket',
    parameters: z.object({
      ticketId: z
        .string()
        .optional()
        .describe('Optional ticket ID to filter by (full UUID or unique prefix)'),
    }),
    execute: async (params) => {
      const ticketId = params.ticketId ? resolveTicketId(db, params.ticketId) : undefined;
      const history = listStatusHistory(db, ticketId);
      return JSON.stringify(history, null, 2);
    },
  });

  server.addTool({
    name: 'list_goal_status_history',
    description:
      'List status changes for all goals or one goal, oldest first. A row with source ' +
      "'backfill' is a snapshot taken when tracking began, not a real transition.",
    parameters: z.object({
      goalId: z
        .string()
        .optional()
        .describe('Optional goal ID to filter by (full UUID or unique prefix)'),
    }),
    execute: async (params) => {
      const goalId = params.goalId ? resolveGoalId(db, params.goalId) : undefined;
      return JSON.stringify(listGoalStatusHistory(db, goalId), null, 2);
    },
  });
}

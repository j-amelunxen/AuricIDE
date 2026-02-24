import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { insertStatusHistory } from './history';

interface Ticket {
  id: string;
  epic_id: string;
  name: string;
  description: string;
  status: string;
  sort_order: number;
  context: string;
  status_updated_at: string;
  working_directory: string | null;
  priority: string;
  model_power: string | null;
  needs_human_supervision: number;
  created_at: string;
  updated_at: string;
}

const FETCH_NEXT_TASK_SQL = `
  SELECT id FROM pm_tickets
  WHERE status = 'open'
    AND needs_human_supervision = 0
  ORDER BY
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'normal' THEN 2
      WHEN 'low' THEN 3
      ELSE 4
    END,
    sort_order ASC
  LIMIT 1
`;

const UPDATE_STATUS_SQL = `
  UPDATE pm_tickets
  SET status = ?, status_updated_at = datetime('now'), updated_at = datetime('now')
  WHERE id = ?
`;

const SELECT_TICKET_SQL = `
  SELECT * FROM pm_tickets WHERE id = ?
`;

const UPDATE_DESCRIPTION_SQL = `
  UPDATE pm_tickets
  SET description = ?, updated_at = datetime('now')
  WHERE id = ?
`;

/**
 * Finds the highest-priority open ticket, atomically sets it to 'in_progress',
 * and returns the updated ticket. Returns null if no open tickets exist.
 */
export function fetchNextTask(db: Database.Database): Ticket | null {
  const transact = db.transaction(() => {
    const candidate = db.prepare(FETCH_NEXT_TASK_SQL).get() as { id: string } | undefined;

    if (!candidate) {
      return null;
    }

    db.prepare(UPDATE_STATUS_SQL).run('in_progress', candidate.id);
    insertStatusHistory(db, candidate.id, 'open', 'in_progress', 'mcp');

    return db.prepare(SELECT_TICKET_SQL).get(candidate.id) as Ticket;
  });

  return transact();
}

const FETCH_NEXT_UNBLOCKED_TASK_SQL = `
  SELECT id FROM pm_tickets
  WHERE status = 'open'
    AND needs_human_supervision = 0
    AND id NOT IN (
      SELECT d.source_id
      FROM pm_dependencies d
      JOIN pm_tickets t ON d.target_type = 'ticket' AND d.target_id = t.id
      WHERE t.status NOT IN ('done', 'archived')
    )
  ORDER BY
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'normal' THEN 2
      WHEN 'low' THEN 3
      ELSE 4
    END,
    sort_order ASC
  LIMIT 1
`;

/**
 * Like fetchNextTask but dependency-aware: skips tickets whose dependencies
 * are not yet done/archived. Returns the highest-priority unblocked open ticket,
 * atomically sets it to 'in_progress'. Returns null if none available.
 */
export function fetchNextUnblockedTask(db: Database.Database): Ticket | null {
  const transact = db.transaction(() => {
    const candidate = db.prepare(FETCH_NEXT_UNBLOCKED_TASK_SQL).get() as { id: string } | undefined;

    if (!candidate) {
      return null;
    }

    db.prepare(UPDATE_STATUS_SQL).run('in_progress', candidate.id);
    insertStatusHistory(db, candidate.id, 'open', 'in_progress', 'mcp');

    return db.prepare(SELECT_TICKET_SQL).get(candidate.id) as Ticket;
  });

  return transact();
}

/**
 * Marks a ticket as 'done'. Optionally appends a completion summary to the description.
 * Throws if the ticket does not exist.
 */
export function completeTask(
  db: Database.Database,
  params: { id: string; summary?: string }
): Ticket {
  const { id, summary } = params;

  const transact = db.transaction(() => {
    const existing = db.prepare(SELECT_TICKET_SQL).get(id) as Ticket | undefined;

    if (!existing) {
      throw new Error(`Ticket not found: ${id}`);
    }

    if (summary) {
      const updatedDescription = existing.description + '\n\n---\nCompletion Summary: ' + summary;
      db.prepare(UPDATE_DESCRIPTION_SQL).run(updatedDescription, id);
    }

    db.prepare(UPDATE_STATUS_SQL).run('done', id);
    insertStatusHistory(db, id, existing.status, 'done', 'mcp');

    return db.prepare(SELECT_TICKET_SQL).get(id) as Ticket;
  });

  return transact();
}

/**
 * Registers the fetch_next_task and complete_task tools with a FastMCP server.
 */
export function registerTaskTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'fetch_next_task',
    description:
      'Fetches the highest-priority open ticket, atomically sets it to in_progress, ' +
      'and returns it. Returns null if no open tickets exist. ' +
      'Skips tickets flagged as needing human supervision. ' +
      'Priority order: critical > high > normal > low.',
    parameters: z.object({}),
    execute: async () => {
      const ticket = fetchNextTask(db);
      return JSON.stringify(ticket);
    },
  });

  server.addTool({
    name: 'fetch_next_unblocked_task',
    description:
      'Like fetch_next_task but dependency-aware. Fetches the highest-priority open ticket ' +
      'that has NO unfinished dependencies (all dependencies must be done or archived). ' +
      'Atomically sets it to in_progress. Returns null if no unblocked open tickets exist. ' +
      'Skips tickets flagged as needing human supervision. ' +
      'Priority order: critical > high > normal > low.',
    parameters: z.object({}),
    execute: async () => {
      const ticket = fetchNextUnblockedTask(db);
      return JSON.stringify(ticket);
    },
  });

  server.addTool({
    name: 'complete_task',
    description:
      'Marks a ticket as done. Optionally appends a completion summary to the description.',
    parameters: z.object({
      id: z.string().describe('The ticket ID to mark as complete'),
      summary: z
        .string()
        .optional()
        .describe('Optional completion summary to append to the description'),
    }),
    execute: async (args) => {
      const ticket = completeTask(db, args);
      return JSON.stringify(ticket);
    },
  });
}

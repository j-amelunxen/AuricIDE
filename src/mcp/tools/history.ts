import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';

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

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerHistoryTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_status_history',
    description: 'List status change history for all tickets or a specific ticket',
    parameters: z.object({
      ticketId: z.string().optional().describe('Optional ticket ID to filter by'),
    }),
    execute: async (params) => {
      const history = listStatusHistory(db, params.ticketId);
      return JSON.stringify(history, null, 2);
    },
  });
}

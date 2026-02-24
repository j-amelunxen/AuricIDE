import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { insertStatusHistory } from './history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Ticket {
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

export interface ListTicketsParams {
  status?: string;
  epicId?: string;
}

export interface CreateTicketParams {
  epicId: string;
  name: string;
  description?: string;
  priority?: string;
}

export interface UpdateTicketParams {
  id: string;
  status?: string;
  name?: string;
  description?: string;
  priority?: string;
  needsHumanSupervision?: boolean;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function listTickets(db: Database.Database, params?: ListTicketsParams): Ticket[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params?.status) {
    conditions.push('status = ?');
    values.push(params.status);
  }

  if (params?.epicId) {
    conditions.push('epic_id = ?');
    values.push(params.epicId);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM pm_tickets${where} ORDER BY sort_order`;

  return db.prepare(sql).all(...values) as Ticket[];
}

export function createTicket(db: Database.Database, params: CreateTicketParams): Ticket {
  const id = crypto.randomUUID();
  const description = params.description ?? '';
  const priority = params.priority ?? 'normal';
  const status = 'open';

  const maxRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM pm_tickets WHERE epic_id = ?')
    .get(params.epicId) as { max_sort: number };
  const sortOrder = maxRow.max_sort + 1;

  db.prepare(
    `INSERT INTO pm_tickets (id, epic_id, name, description, status, sort_order, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.epicId, params.name, description, status, sortOrder, priority);

  insertStatusHistory(db, id, null, 'open', 'mcp');

  return db.prepare('SELECT * FROM pm_tickets WHERE id = ?').get(id) as Ticket;
}

export function updateTicket(db: Database.Database, params: UpdateTicketParams): Ticket {
  const existing = db.prepare('SELECT * FROM pm_tickets WHERE id = ?').get(params.id) as
    | Ticket
    | undefined;

  if (!existing) {
    throw new Error(`Ticket not found: ${params.id}`);
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (params.name !== undefined) {
    setClauses.push('name = ?');
    values.push(params.name);
  }

  if (params.description !== undefined) {
    setClauses.push('description = ?');
    values.push(params.description);
  }

  if (params.priority !== undefined) {
    setClauses.push('priority = ?');
    values.push(params.priority);
  }

  if (params.status !== undefined) {
    setClauses.push('status = ?');
    values.push(params.status);
    setClauses.push("status_updated_at = datetime('now')");
  }

  if (params.needsHumanSupervision !== undefined) {
    setClauses.push('needs_human_supervision = ?');
    values.push(params.needsHumanSupervision ? 1 : 0);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = datetime('now')");
    const sql = `UPDATE pm_tickets SET ${setClauses.join(', ')} WHERE id = ?`;
    values.push(params.id);
    db.prepare(sql).run(...values);
  }

  if (params.status !== undefined && params.status !== existing.status) {
    insertStatusHistory(db, params.id, existing.status, params.status, 'mcp');
  }

  return db.prepare('SELECT * FROM pm_tickets WHERE id = ?').get(params.id) as Ticket;
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerTicketTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_tickets',
    description: 'List tickets with optional status and epicId filters',
    parameters: z.object({
      status: z.string().optional().describe('Filter by ticket status (e.g. open, done)'),
      epicId: z.string().optional().describe('Filter by epic ID'),
    }),
    execute: async (params) => {
      const tickets = listTickets(db, params);
      return JSON.stringify(tickets, null, 2);
    },
  });

  server.addTool({
    name: 'create_ticket',
    description: 'Create a new ticket in an epic',
    parameters: z.object({
      epicId: z.string().describe('The epic ID to create the ticket in'),
      name: z.string().describe('Ticket name'),
      description: z.string().optional().describe('Ticket description'),
      priority: z.string().optional().describe('Ticket priority (default: normal)'),
    }),
    execute: async (params) => {
      const ticket = createTicket(db, params);
      return JSON.stringify(ticket, null, 2);
    },
  });

  server.addTool({
    name: 'update_ticket',
    description: 'Update an existing ticket',
    parameters: z.object({
      id: z.string().describe('The ticket ID to update'),
      status: z.string().optional().describe('New status'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
      priority: z.string().optional().describe('New priority'),
      needsHumanSupervision: z
        .boolean()
        .optional()
        .describe('Flag to require human supervision (skipped by automatic task fetching)'),
    }),
    execute: async (params) => {
      const ticket = updateTicket(db, params);
      return JSON.stringify(ticket, null, 2);
    },
  });
}

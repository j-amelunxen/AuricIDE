import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { insertStatusHistory } from './history';
import { resolveEpicId, resolveTicketId } from './resolve';

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

export interface UnfinishedOverview {
  epicName: string;
  tickets: {
    id: string;
    name: string;
    status: string;
    heat: number;
    blockedBy: string[];
  }[];
}

export function getUnfinishedOverview(db: Database.Database): UnfinishedOverview[] {
  const epics = db.prepare('SELECT id, name FROM pm_epics ORDER BY sort_order').all() as {
    id: string;
    name: string;
  }[];

  const tickets = db
    .prepare(
      `SELECT id, epic_id, name, status
       FROM pm_tickets
       WHERE status NOT IN ('done', 'archived')
       ORDER BY sort_order`
    )
    .all() as { id: string; epic_id: string; name: string; status: string }[];

  const dependencies = db
    .prepare(
      `SELECT d.source_id, d.target_id, t.name as target_name
       FROM pm_dependencies d
       JOIN pm_tickets t ON d.target_id = t.id
       WHERE d.source_type = 'ticket' AND d.target_type = 'ticket'`
    )
    .all() as { source_id: string; target_id: string; target_name: string }[];

  const heatMap = new Map<string, number>();
  for (const dep of dependencies) {
    heatMap.set(dep.target_id, (heatMap.get(dep.target_id) || 0) + 1);
  }

  const blockedByMap = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = blockedByMap.get(dep.source_id) || [];
    list.push(dep.target_name);
    blockedByMap.set(dep.source_id, list);
  }

  const result: UnfinishedOverview[] = [];

  for (const epic of epics) {
    const epicTickets = tickets
      .filter((t) => t.epic_id === epic.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        heat: heatMap.get(t.id) || 0,
        blockedBy: blockedByMap.get(t.id) || [],
      }));

    if (epicTickets.length > 0) {
      result.push({
        epicName: epic.name,
        tickets: epicTickets,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerTicketTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_tickets',
    description:
      'List tickets with optional status and epicId filters. ' +
      'Use status="in_progress" to list in-progress tickets.',
    parameters: z.object({
      status: z.string().optional().describe('Filter by ticket status (e.g. open, done)'),
      epicId: z.string().optional().describe('Filter by epic ID (full UUID or unique prefix)'),
    }),
    execute: async (params) => {
      const epicId = params.epicId ? resolveEpicId(db, params.epicId) : undefined;
      const tickets = listTickets(db, { ...params, epicId });
      return JSON.stringify(tickets, null, 2);
    },
  });

  server.addTool({
    name: 'get_unfinished_tickets_overview',
    description:
      'Provides a high-level overview of all unfinished tickets (not done/archived), grouped by epic. ' +
      'Includes heat (number of dependents) and blocking dependency names. Minimal details for context efficiency.',
    parameters: z.object({}),
    execute: async () => {
      const overview = getUnfinishedOverview(db);
      return JSON.stringify(overview, null, 2);
    },
  });

  server.addTool({
    name: 'create_ticket',
    description: 'Create a new ticket in an epic',
    parameters: z.object({
      epicId: z
        .string()
        .describe('The epic ID to create the ticket in (full UUID or unique prefix)'),
      name: z.string().describe('Ticket name'),
      description: z.string().optional().describe('Ticket description'),
      priority: z.string().optional().describe('Ticket priority (default: normal)'),
    }),
    execute: async (params) => {
      const epicId = resolveEpicId(db, params.epicId);
      const ticket = createTicket(db, { ...params, epicId });
      return JSON.stringify(ticket, null, 2);
    },
  });

  server.addTool({
    name: 'update_ticket',
    description: 'Update an existing ticket',
    parameters: z.object({
      id: z.string().describe('The ticket ID to update (full UUID or unique prefix)'),
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
      const id = resolveTicketId(db, params.id);
      const ticket = updateTicket(db, { ...params, id });
      return JSON.stringify(ticket, null, 2);
    },
  });
}

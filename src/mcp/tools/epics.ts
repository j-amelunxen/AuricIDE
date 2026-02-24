import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

interface EpicRow {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface EpicWithTicketCount extends EpicRow {
  ticketCount: number;
}

interface EpicRowWithCount extends EpicRow {
  ticket_count: number;
}

export function listEpics(db: Database.Database): EpicWithTicketCount[] {
  const rows = db
    .prepare(
      `SELECT e.*, COUNT(t.id) as ticket_count
       FROM pm_epics e
       LEFT JOIN pm_tickets t ON t.epic_id = e.id
       GROUP BY e.id
       ORDER BY e.sort_order`
    )
    .all() as EpicRowWithCount[];

  return rows.map(({ ticket_count, ...rest }) => ({
    ...rest,
    ticketCount: ticket_count,
  }));
}

export function createEpic(
  db: Database.Database,
  params: { name: string; description?: string }
): EpicRow {
  const id = crypto.randomUUID();
  const description = params.description ?? '';

  const maxSortOrder = db.prepare('SELECT MAX(sort_order) as max_sort FROM pm_epics').get() as {
    max_sort: number | null;
  };

  const sortOrder = maxSortOrder.max_sort === null ? 0 : maxSortOrder.max_sort + 1;

  db.prepare(
    `INSERT INTO pm_epics (id, name, description, sort_order)
     VALUES (?, ?, ?, ?)`
  ).run(id, params.name, description, sortOrder);

  const created = db.prepare('SELECT * FROM pm_epics WHERE id = ?').get(id) as EpicRow;

  return created;
}

export interface EpicWithTickets extends EpicRow {
  tickets: TicketRow[];
}

interface TicketRow {
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
  created_at: string;
  updated_at: string;
}

export function getEpicWithTickets(db: Database.Database, epicId: string): EpicWithTickets | null {
  const epic = db.prepare('SELECT * FROM pm_epics WHERE id = ?').get(epicId) as EpicRow | undefined;

  if (!epic) return null;

  const tickets = db
    .prepare('SELECT * FROM pm_tickets WHERE epic_id = ? ORDER BY sort_order')
    .all(epicId) as TicketRow[];

  return { ...epic, tickets };
}

export function listEpicsWithTickets(db: Database.Database): EpicWithTickets[] {
  const epics = db.prepare('SELECT * FROM pm_epics ORDER BY sort_order').all() as EpicRow[];

  return epics.map((epic) => {
    const tickets = db
      .prepare('SELECT * FROM pm_tickets WHERE epic_id = ? ORDER BY sort_order')
      .all(epic.id) as TicketRow[];
    return { ...epic, tickets };
  });
}

export function registerEpicTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_epics',
    description: 'List all epics with their ticket counts',
    parameters: z.object({}),
    execute: async () => JSON.stringify(listEpics(db)),
  });

  server.addTool({
    name: 'create_epic',
    description: 'Create a new epic',
    parameters: z.object({
      name: z.string().describe('The name of the epic'),
      description: z.string().optional().describe('Optional description for the epic'),
    }),
    execute: async (params) => JSON.stringify(createEpic(db, params)),
  });

  server.addTool({
    name: 'get_epic_with_tickets',
    description: 'Get a single epic with all its tickets nested',
    parameters: z.object({
      epicId: z.string().describe('The epic ID to retrieve'),
    }),
    execute: async ({ epicId }) => {
      const result = getEpicWithTickets(db, epicId);
      if (!result) return JSON.stringify({ error: 'Epic not found' });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'list_epics_with_tickets',
    description: 'List all epics with their full tickets nested inside each epic',
    parameters: z.object({}),
    execute: async () => JSON.stringify(listEpicsWithTickets(db), null, 2),
  });
}

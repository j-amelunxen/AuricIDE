import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveTicketId } from './resolve';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCaseRow {
  id: string;
  ticket_id: string;
  title: string;
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTestCaseParams {
  ticketId: string;
  title: string;
  body?: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function createTestCase(db: Database.Database, params: CreateTestCaseParams): TestCaseRow {
  const id = crypto.randomUUID();
  const body = params.body ?? '';

  const maxRow = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM pm_test_cases WHERE ticket_id = ?'
    )
    .get(params.ticketId) as { max_sort: number };
  const sortOrder = maxRow.max_sort + 1;

  db.prepare(
    `INSERT INTO pm_test_cases (id, ticket_id, title, body, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, params.ticketId, params.title, body, sortOrder);

  return db.prepare('SELECT * FROM pm_test_cases WHERE id = ?').get(id) as TestCaseRow;
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerTestCaseTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'create_test_case',
    description: 'Create a test case linked to a ticket',
    parameters: z.object({
      ticketId: z
        .string()
        .describe('The ticket ID to link the test case to (full UUID or unique prefix)'),
      title: z.string().describe('Test case title'),
      body: z.string().optional().describe('Test case body/description'),
    }),
    execute: async (params) => {
      const ticketId = resolveTicketId(db, params.ticketId);
      const tc = createTestCase(db, { ...params, ticketId });
      return JSON.stringify(tc, null, 2);
    },
  });
}

import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextItem {
  id: string;
  type: 'snippet' | 'file';
  value: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertTicketExists(db: Database.Database, ticketId: string): void {
  const row = db.prepare('SELECT id FROM pm_tickets WHERE id = ?').get(ticketId);
  if (!row) throw new Error(`Ticket not found: ${ticketId}`);
}

function readContext(db: Database.Database, ticketId: string): ContextItem[] {
  const row = db.prepare('SELECT context FROM pm_tickets WHERE id = ?').get(ticketId) as
    | { context: string }
    | undefined;
  if (!row) throw new Error(`Ticket not found: ${ticketId}`);
  return JSON.parse(row.context) as ContextItem[];
}

function writeContext(db: Database.Database, ticketId: string, items: ContextItem[]): void {
  db.prepare("UPDATE pm_tickets SET context = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(items),
    ticketId
  );
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Returns the parsed context items for a ticket.
 * Throws if the ticket does not exist.
 */
export function getTicketContext(db: Database.Database, ticketId: string): ContextItem[] {
  return readContext(db, ticketId);
}

/**
 * Appends a new context item (snippet or file reference) to a ticket.
 * Returns the full updated context.
 * Throws if the ticket does not exist.
 */
export function addContextItem(
  db: Database.Database,
  ticketId: string,
  type: 'snippet' | 'file',
  value: string
): ContextItem[] {
  const current = readContext(db, ticketId); // also validates ticket exists
  const newItem: ContextItem = { id: crypto.randomUUID(), type, value };
  const updated = [...current, newItem];
  writeContext(db, ticketId, updated);
  return updated;
}

/**
 * Removes a context item by its id from a ticket's context.
 * If the item id does not exist, this is a no-op.
 * Returns the full updated context.
 * Throws if the ticket does not exist.
 */
export function removeContextItem(
  db: Database.Database,
  ticketId: string,
  itemId: string
): ContextItem[] {
  const current = readContext(db, ticketId); // also validates ticket exists
  const updated = current.filter((item) => item.id !== itemId);
  writeContext(db, ticketId, updated);
  return updated;
}

/**
 * Clears all context items from a ticket.
 * Throws if the ticket does not exist.
 */
export function clearTicketContext(db: Database.Database, ticketId: string): void {
  assertTicketExists(db, ticketId);
  writeContext(db, ticketId, []);
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerContextTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'get_ticket_context',
    description:
      'Get all context items (snippets and file references) attached to a ticket. ' +
      'Context items are injected into the agent prompt when working on the ticket.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID'),
    }),
    execute: async ({ ticketId }) => {
      const items = getTicketContext(db, ticketId);
      return JSON.stringify(items, null, 2);
    },
  });

  server.addTool({
    name: 'add_context_snippet',
    description:
      'Attach a text/code snippet to a ticket as context. ' +
      'The snippet will be included verbatim in the agent prompt. ' +
      'Returns the full updated context.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID'),
      value: z.string().describe('The snippet text or code to attach'),
    }),
    execute: async ({ ticketId, value }) => {
      const items = addContextItem(db, ticketId, 'snippet', value);
      return JSON.stringify(items, null, 2);
    },
  });

  server.addTool({
    name: 'add_context_file',
    description:
      'Attach a file reference to a ticket as context. ' +
      'The file path is relative to the project root. ' +
      'The file content will be read and included in the agent prompt. ' +
      'Returns the full updated context.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID'),
      filePath: z
        .string()
        .describe('Relative path to the file from the project root (e.g. src/lib/utils.ts)'),
    }),
    execute: async ({ ticketId, filePath }) => {
      const items = addContextItem(db, ticketId, 'file', filePath);
      return JSON.stringify(items, null, 2);
    },
  });

  server.addTool({
    name: 'remove_context_item',
    description:
      'Remove a specific context item from a ticket by its item id. ' +
      'Use get_ticket_context to retrieve item ids first. ' +
      'Returns the full updated context.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID'),
      itemId: z.string().describe('The context item ID to remove'),
    }),
    execute: async ({ ticketId, itemId }) => {
      const items = removeContextItem(db, ticketId, itemId);
      return JSON.stringify(items, null, 2);
    },
  });

  server.addTool({
    name: 'clear_ticket_context',
    description: 'Remove all context items (snippets and file references) from a ticket.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID'),
    }),
    execute: async ({ ticketId }) => {
      clearTicketContext(db, ticketId);
      return JSON.stringify({ ticketId, context: [] });
    },
  });
}

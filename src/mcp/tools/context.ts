import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveTicketId } from './resolve';

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
      ticketId: z.string().describe('The ticket ID (full UUID or unique prefix)'),
    }),
    execute: async ({ ticketId }) => {
      const resolved = resolveTicketId(db, ticketId);
      const items = getTicketContext(db, resolved);
      return JSON.stringify(items, null, 2);
    },
  });

  server.addTool({
    name: 'add_context_item',
    description:
      'Attach a context item (text/code snippet or file reference) to a ticket. ' +
      'Snippets are included verbatim in the agent prompt; ' +
      'file references cause the file content to be read and included. ' +
      'Returns the full updated context.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID (full UUID or unique prefix)'),
      type: z.enum(['snippet', 'file']).describe('Whether this is a text snippet or a file path'),
      value: z.string().describe('Text/code snippet, or relative file path from project root'),
    }),
    execute: async ({ ticketId, type, value }) => {
      const resolved = resolveTicketId(db, ticketId);
      const items = addContextItem(db, resolved, type, value);
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
      ticketId: z.string().describe('The ticket ID (full UUID or unique prefix)'),
      itemId: z.string().describe('The context item ID to remove'),
    }),
    execute: async ({ ticketId, itemId }) => {
      const resolved = resolveTicketId(db, ticketId);
      const items = removeContextItem(db, resolved, itemId);
      return JSON.stringify(items, null, 2);
    },
  });

  server.addTool({
    name: 'clear_ticket_context',
    description: 'Remove all context items (snippets and file references) from a ticket.',
    parameters: z.object({
      ticketId: z.string().describe('The ticket ID (full UUID or unique prefix)'),
    }),
    execute: async ({ ticketId }) => {
      const resolved = resolveTicketId(db, ticketId);
      clearTicketContext(db, resolved);
      return JSON.stringify({ ticketId: resolved, context: [] });
    },
  });
}

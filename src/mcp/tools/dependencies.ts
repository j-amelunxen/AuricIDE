import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveId, resolveTicketId, typeToTable } from './resolve';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyRow {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
}

export interface CreateDependencyParams {
  sourceId: string;
  targetId: string;
  sourceType?: string;
  targetType?: string;
}

export interface ListDependenciesParams {
  ticketId?: string;
}

export interface DependencyInfo {
  id: string;
  source_type: string;
  source_id: string;
  source_name: string;
  source_status: string;
  target_type: string;
  target_id: string;
  target_name: string;
  target_status: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function createDependency(
  db: Database.Database,
  params: CreateDependencyParams
): DependencyRow {
  const id = crypto.randomUUID();
  const sourceType = params.sourceType ?? 'ticket';
  const targetType = params.targetType ?? 'ticket';

  db.prepare(
    `INSERT OR IGNORE INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, sourceType, params.sourceId, targetType, params.targetId);

  const row = db
    .prepare('SELECT * FROM pm_dependencies WHERE source_id = ? AND target_id = ?')
    .get(params.sourceId, params.targetId) as DependencyRow;

  return row;
}

export function listDependencies(
  db: Database.Database,
  params?: ListDependenciesParams
): DependencyInfo[] {
  const baseSql = `
    SELECT
      d.id,
      d.source_type,
      d.source_id,
      COALESCE(st.name, d.source_id) AS source_name,
      COALESCE(st.status, '') AS source_status,
      d.target_type,
      d.target_id,
      COALESCE(tt.name, d.target_id) AS target_name,
      COALESCE(tt.status, '') AS target_status
    FROM pm_dependencies d
    LEFT JOIN pm_tickets st ON d.source_type = 'ticket' AND d.source_id = st.id
    LEFT JOIN pm_tickets tt ON d.target_type = 'ticket' AND d.target_id = tt.id
  `;

  if (params?.ticketId) {
    const sql = baseSql + ` WHERE d.source_id = ? OR d.target_id = ?`;
    return db.prepare(sql).all(params.ticketId, params.ticketId) as DependencyInfo[];
  }

  return db.prepare(baseSql).all() as DependencyInfo[];
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerDependencyTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'create_dependency',
    description:
      'Create a dependency between two items (tickets or epics). Idempotent — duplicates are ignored.',
    parameters: z.object({
      sourceId: z.string().describe('The source item ID (full UUID or unique prefix)'),
      targetId: z
        .string()
        .describe(
          'The target item ID (the item that source depends on, full UUID or unique prefix)'
        ),
      sourceType: z.string().optional().describe('Source type (default: ticket)'),
      targetType: z.string().optional().describe('Target type (default: ticket)'),
    }),
    execute: async (params) => {
      const sourceId = resolveId(db, typeToTable(params.sourceType ?? 'ticket'), params.sourceId);
      const targetId = resolveId(db, typeToTable(params.targetType ?? 'ticket'), params.targetId);
      const dep = createDependency(db, { ...params, sourceId, targetId });
      return JSON.stringify(dep, null, 2);
    },
  });

  server.addTool({
    name: 'list_dependencies',
    description:
      'List dependencies, optionally filtered by a specific ticket. ' +
      'Returns enriched data with ticket names and statuses. ' +
      'Semantics: source depends on target (target blocks source).',
    parameters: z.object({
      ticketId: z
        .string()
        .optional()
        .describe(
          'Optional ticket ID to filter dependencies for (as source or target, full UUID or unique prefix)'
        ),
    }),
    execute: async (params) => {
      const ticketId = params.ticketId ? resolveTicketId(db, params.ticketId) : undefined;
      const deps = listDependencies(db, { ticketId });
      return JSON.stringify(deps, null, 2);
    },
  });
}

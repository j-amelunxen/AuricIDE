import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveRequirementId } from './resolve';

interface RequirementRow {
  id: string;
  req_id: string;
  title: string;
  description: string;
  type: string;
  category: string;
  priority: string;
  status: string;
  rationale: string;
  acceptance_criteria: string;
  source: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function listRequirements(
  db: Database.Database,
  filters?: { type?: string; category?: string; status?: string }
): RequirementRow[] {
  let sql = 'SELECT * FROM pm_requirements WHERE 1=1';
  const params: string[] = [];

  if (filters?.type) {
    sql += ' AND type = ?';
    params.push(filters.type);
  }
  if (filters?.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }
  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }

  sql += ' ORDER BY sort_order, req_id';
  return db.prepare(sql).all(...params) as RequirementRow[];
}

export function getRequirement(db: Database.Database, id: string): RequirementRow | null {
  return (
    (db.prepare('SELECT * FROM pm_requirements WHERE id = ?').get(id) as
      | RequirementRow
      | undefined) ?? null
  );
}

export function createRequirement(
  db: Database.Database,
  params: {
    reqId: string;
    title: string;
    description?: string;
    type?: string;
    category?: string;
    priority?: string;
    status?: string;
    rationale?: string;
    acceptanceCriteria?: string;
    source?: string;
    sortOrder?: number;
  }
): RequirementRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    `INSERT INTO pm_requirements (id, req_id, title, description, type, category, priority, status, rationale, acceptance_criteria, source, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.reqId,
    params.title,
    params.description ?? '',
    params.type ?? 'functional',
    params.category ?? '',
    params.priority ?? 'normal',
    params.status ?? 'draft',
    params.rationale ?? '',
    params.acceptanceCriteria ?? '',
    params.source ?? '',
    params.sortOrder ?? 0,
    now,
    now
  );

  return db.prepare('SELECT * FROM pm_requirements WHERE id = ?').get(id) as RequirementRow;
}

export function updateRequirement(
  db: Database.Database,
  id: string,
  updates: Partial<{
    reqId: string;
    title: string;
    description: string;
    type: string;
    category: string;
    priority: string;
    status: string;
    rationale: string;
    acceptanceCriteria: string;
    source: string;
    sortOrder: number;
  }>
): RequirementRow {
  const fieldMap: Record<string, string> = {
    reqId: 'req_id',
    title: 'title',
    description: 'description',
    type: 'type',
    category: 'category',
    priority: 'priority',
    status: 'status',
    rationale: 'rationale',
    acceptanceCriteria: 'acceptance_criteria',
    source: 'source',
    sortOrder: 'sort_order',
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const col = fieldMap[key];
    if (col && value !== undefined) {
      setClauses.push(`${col} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) {
    const existing = getRequirement(db, id);
    if (!existing) throw new Error(`Requirement '${id}' not found`);
    return existing;
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE pm_requirements SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  const result = getRequirement(db, id);
  if (!result) throw new Error(`Requirement '${id}' not found after update`);
  return result;
}

export function deleteRequirement(db: Database.Database, id: string): boolean {
  const changes = db.prepare('DELETE FROM pm_requirements WHERE id = ?').run(id).changes;
  return changes > 0;
}

export function importRequirements(
  db: Database.Database,
  requirements: Array<{
    reqId: string;
    title: string;
    description?: string;
    type?: string;
    category?: string;
    priority?: string;
    status?: string;
    rationale?: string;
    acceptanceCriteria?: string;
    source?: string;
    sortOrder?: number;
  }>
): RequirementRow[] {
  const results: RequirementRow[] = [];
  const insertMany = db.transaction(() => {
    for (const req of requirements) {
      results.push(createRequirement(db, req));
    }
  });
  insertMany();
  return results;
}

export function registerRequirementTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_requirements',
    description: 'List all requirements, optionally filtered by type, category, or status',
    parameters: z.object({
      type: z
        .enum(['functional', 'non_functional'])
        .optional()
        .describe('Filter by requirement type'),
      category: z.string().optional().describe('Filter by category'),
      status: z
        .enum(['draft', 'active', 'implemented', 'verified', 'deprecated'])
        .optional()
        .describe('Filter by status'),
    }),
    execute: async (filters) => {
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined)
      );
      return JSON.stringify(
        listRequirements(db, Object.keys(cleanFilters).length > 0 ? cleanFilters : undefined)
      );
    },
  });

  server.addTool({
    name: 'get_requirement',
    description: 'Get a single requirement by UUID, UUID prefix, or req_id (e.g. "REQ-AUTH-01")',
    parameters: z.object({
      id: z
        .string()
        .describe(
          'The requirement ID to retrieve (full UUID, unique prefix, or req_id like "REQ-AUTH-01")'
        ),
    }),
    execute: async ({ id }) => {
      const resolved = resolveRequirementId(db, id);
      const result = getRequirement(db, resolved);
      if (!result) return JSON.stringify({ error: 'Requirement not found' });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'create_requirement',
    description: 'Create a new requirement',
    parameters: z.object({
      reqId: z.string().describe('Human-readable ID like "REQ-AUTH-01"'),
      title: z.string().describe('Short title'),
      description: z.string().optional().describe('Full markdown description'),
      type: z.enum(['functional', 'non_functional']).optional().describe('Requirement type'),
      category: z.string().optional().describe('Category for grouping'),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('Priority level'),
      status: z
        .enum(['draft', 'active', 'implemented', 'verified', 'deprecated'])
        .optional()
        .describe('Current status'),
      rationale: z.string().optional().describe('Why this requirement exists'),
      acceptanceCriteria: z.string().optional().describe('Markdown acceptance criteria'),
      source: z.string().optional().describe('Origin document or reference'),
      sortOrder: z.number().optional().describe('Display sort order'),
    }),
    execute: async (params) => JSON.stringify(createRequirement(db, params)),
  });

  server.addTool({
    name: 'update_requirement',
    description: 'Update fields of an existing requirement',
    parameters: z.object({
      id: z.string().describe('Requirement ID (UUID, prefix, or req_id)'),
      reqId: z.string().optional().describe('New human-readable ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      type: z.enum(['functional', 'non_functional']).optional().describe('New type'),
      category: z.string().optional().describe('New category'),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional().describe('New priority'),
      status: z
        .enum(['draft', 'active', 'implemented', 'verified', 'deprecated'])
        .optional()
        .describe('New status'),
      rationale: z.string().optional().describe('New rationale'),
      acceptanceCriteria: z.string().optional().describe('New acceptance criteria'),
      source: z.string().optional().describe('New source'),
      sortOrder: z.number().optional().describe('New sort order'),
    }),
    execute: async ({ id, ...updates }) => {
      const resolved = resolveRequirementId(db, id);
      return JSON.stringify(updateRequirement(db, resolved, updates));
    },
  });

  server.addTool({
    name: 'delete_requirement',
    description: 'Delete a requirement by ID',
    parameters: z.object({
      id: z.string().describe('Requirement ID (UUID, prefix, or req_id)'),
    }),
    execute: async ({ id }) => {
      const resolved = resolveRequirementId(db, id);
      const deleted = deleteRequirement(db, resolved);
      return JSON.stringify({ deleted });
    },
  });

  server.addTool({
    name: 'import_requirements',
    description: 'Bulk-import multiple requirements at once (the agent use case)',
    parameters: z.object({
      requirements: z
        .array(
          z.object({
            reqId: z.string().describe('Human-readable ID'),
            title: z.string().describe('Short title'),
            description: z.string().optional(),
            type: z.enum(['functional', 'non_functional']).optional(),
            category: z.string().optional(),
            priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
            status: z.enum(['draft', 'active', 'implemented', 'verified', 'deprecated']).optional(),
            rationale: z.string().optional(),
            acceptanceCriteria: z.string().optional(),
            source: z.string().optional(),
            sortOrder: z.number().optional(),
          })
        )
        .describe('Array of requirements to import'),
    }),
    execute: async ({ requirements }) => JSON.stringify(importRequirements(db, requirements)),
  });
}

import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';

interface BlueprintRow {
  id: string;
  name: string;
  tech_stack: string;
  goal: string;
  complexity: string;
  category: string;
  description: string;
  spec: string;
  created_at: string;
  updated_at: string;
}

export function listBlueprints(db: Database.Database, category?: string): BlueprintRow[] {
  if (category) {
    return db
      .prepare('SELECT * FROM blueprints WHERE category = ? ORDER BY category, name')
      .all(category) as BlueprintRow[];
  }
  return db.prepare('SELECT * FROM blueprints ORDER BY category, name').all() as BlueprintRow[];
}

export function getBlueprint(db: Database.Database, id: string): BlueprintRow | null {
  return (
    (db.prepare('SELECT * FROM blueprints WHERE id = ?').get(id) as BlueprintRow | undefined) ??
    null
  );
}

export function createBlueprint(
  db: Database.Database,
  params: {
    name: string;
    techStack?: string;
    goal?: string;
    complexity?: string;
    category?: string;
    description?: string;
    spec?: string;
  }
): BlueprintRow {
  const id = crypto.randomUUID();
  const techStack = params.techStack ?? '';
  const goal = params.goal ?? '';
  const complexity = params.complexity ?? 'MEDIUM';
  const category = params.category ?? 'architectures';
  const description = params.description ?? '';
  const spec = params.spec ?? '';

  db.prepare(
    `INSERT INTO blueprints (id, name, tech_stack, goal, complexity, category, description, spec)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.name, techStack, goal, complexity, category, description, spec);

  return db.prepare('SELECT * FROM blueprints WHERE id = ?').get(id) as BlueprintRow;
}

export function registerBlueprintTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_blueprints',
    description: 'List all blueprints, optionally filtered by category',
    parameters: z.object({
      category: z
        .enum(['architectures', 'optimizations', 'ui-and-marketing'])
        .optional()
        .describe('Optional category filter'),
    }),
    execute: async ({ category }) => JSON.stringify(listBlueprints(db, category)),
  });

  server.addTool({
    name: 'get_blueprint',
    description: 'Get a single blueprint by ID with full description',
    parameters: z.object({
      id: z.string().describe('The blueprint ID to retrieve'),
    }),
    execute: async ({ id }) => {
      const result = getBlueprint(db, id);
      if (!result) return JSON.stringify({ error: 'Blueprint not found' });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: 'create_blueprint',
    description: 'Create a new blueprint',
    parameters: z.object({
      name: z.string().describe('The name of the blueprint'),
      techStack: z.string().optional().describe('Comma-separated tech stack'),
      goal: z.string().optional().describe('Goal of the blueprint'),
      complexity: z
        .enum(['EASY', 'MEDIUM', 'HARD'])
        .optional()
        .describe('Implementation complexity'),
      category: z
        .enum(['architectures', 'optimizations', 'ui-and-marketing'])
        .optional()
        .describe('Blueprint category'),
      description: z.string().optional().describe('Full markdown description'),
      spec: z.string().optional().describe('Full markdown spec / detailed content'),
    }),
    execute: async (params) => JSON.stringify(createBlueprint(db, params)),
  });
}

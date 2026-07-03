import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveGoalId, resolveRequirementId, resolveTicketId } from './resolve';

export interface GoalRow {
  id: string;
  parent_id: string | null;
  name: string;
  description: string;
  success_criteria: string;
  status: string;
  priority: string;
  goal_prompt: string;
  created_by: string;
  achieved_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GoalRunRow {
  id: string;
  goal_id: string;
  agent_id: string;
  ticket_id: string | null;
  prompt: string;
  model: string;
  provider: string;
  source: string;
  outcome: string;
  summary: string;
  started_at: string;
  finished_at: string | null;
}

interface TicketSummaryRow {
  id: string;
  name: string;
  status: string;
  priority: string;
}

export interface GoalTreeNode extends GoalRow {
  children: GoalTreeNode[];
  tickets: TicketSummaryRow[];
}

const now = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function listGoals(
  db: Database.Database,
  filters?: { status?: string; parentId?: string }
): GoalRow[] {
  let sql = 'SELECT * FROM pm_goals WHERE 1=1';
  const params: string[] = [];
  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.parentId) {
    sql += ' AND parent_id = ?';
    params.push(filters.parentId);
  }
  sql += ' ORDER BY sort_order, created_at';
  return db.prepare(sql).all(...params) as GoalRow[];
}

export function getGoal(db: Database.Database, id: string): GoalRow | null {
  return (db.prepare('SELECT * FROM pm_goals WHERE id = ?').get(id) as GoalRow | undefined) ?? null;
}

export function createGoal(
  db: Database.Database,
  params: {
    name: string;
    parentId?: string;
    description?: string;
    successCriteria?: string;
    status?: string;
    priority?: string;
    goalPrompt?: string;
    sortOrder?: number;
  },
  createdBy: string
): GoalRow {
  if (params.parentId && !getGoal(db, params.parentId)) {
    throw new Error(`Parent goal '${params.parentId}' not found`);
  }
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO pm_goals (id, parent_id, name, description, success_criteria, status, priority, goal_prompt, created_by, achieved_at, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    id,
    params.parentId ?? null,
    params.name,
    params.description ?? '',
    params.successCriteria ?? '',
    params.status ?? 'draft',
    params.priority ?? 'normal',
    params.goalPrompt ?? '',
    createdBy,
    params.sortOrder ?? 0,
    ts,
    ts
  );
  return getGoal(db, id) as GoalRow;
}

export function updateGoal(
  db: Database.Database,
  id: string,
  updates: Partial<{
    name: string;
    parentId: string | null;
    description: string;
    successCriteria: string;
    status: string;
    priority: string;
    goalPrompt: string;
    sortOrder: number;
  }>
): GoalRow {
  const fieldMap: Record<string, string> = {
    name: 'name',
    parentId: 'parent_id',
    description: 'description',
    successCriteria: 'success_criteria',
    status: 'status',
    priority: 'priority',
    goalPrompt: 'goal_prompt',
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

  // Transitioning into 'achieved' stamps achieved_at; leaving it clears it.
  if (updates.status === 'achieved') {
    setClauses.push("achieved_at = datetime('now')");
  } else if (updates.status !== undefined) {
    setClauses.push('achieved_at = NULL');
  }

  if (setClauses.length === 0) {
    const existing = getGoal(db, id);
    if (!existing) throw new Error(`Goal '${id}' not found`);
    return existing;
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE pm_goals SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

  const result = getGoal(db, id);
  if (!result) throw new Error(`Goal '${id}' not found after update`);
  return result;
}

export function deleteGoal(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM pm_goals WHERE id = ?').run(id).changes > 0;
}

export function decomposeGoal(
  db: Database.Database,
  parentId: string,
  children: Array<{
    name: string;
    description?: string;
    successCriteria?: string;
    priority?: string;
    goalPrompt?: string;
  }>,
  createdBy: string
): GoalRow[] {
  if (!getGoal(db, parentId)) throw new Error(`Goal '${parentId}' not found`);
  const results: GoalRow[] = [];
  const insertAll = db.transaction(() => {
    for (const child of children) {
      results.push(createGoal(db, { ...child, parentId, status: 'active' }, createdBy));
    }
  });
  insertAll();
  return results;
}

function ticketsForGoal(db: Database.Database, goalId: string): TicketSummaryRow[] {
  return db
    .prepare(
      'SELECT id, name, status, priority FROM pm_tickets WHERE goal_id = ? ORDER BY sort_order'
    )
    .all(goalId) as TicketSummaryRow[];
}

export function getGoalTree(db: Database.Database, rootId?: string): GoalTreeNode[] {
  const all = listGoals(db);
  const byParent = new Map<string | null, GoalRow[]>();
  for (const goal of all) {
    const key = goal.parent_id;
    const bucket = byParent.get(key) ?? [];
    bucket.push(goal);
    byParent.set(key, bucket);
  }

  const build = (goal: GoalRow, seen: Set<string>): GoalTreeNode => {
    seen.add(goal.id);
    const childRows = (byParent.get(goal.id) ?? []).filter((c) => !seen.has(c.id));
    return {
      ...goal,
      tickets: ticketsForGoal(db, goal.id),
      children: childRows.map((c) => build(c, seen)),
    };
  };

  const seen = new Set<string>();
  const roots = rootId ? all.filter((g) => g.id === rootId) : (byParent.get(null) ?? []);
  return roots.map((r) => build(r, seen));
}

export function linkTicketToGoal(
  db: Database.Database,
  ticketId: string,
  goalId: string | null
): { linked: boolean } {
  const changes = db
    .prepare("UPDATE pm_tickets SET goal_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(goalId, ticketId).changes;
  if (changes === 0) throw new Error(`Ticket '${ticketId}' not found`);
  return { linked: true };
}

export function linkRequirementToGoal(
  db: Database.Database,
  goalId: string,
  requirementId: string
): { linked: true } {
  db.prepare(
    'INSERT OR IGNORE INTO pm_goal_requirement_links (id, goal_id, requirement_id) VALUES (?, ?, ?)'
  ).run(crypto.randomUUID(), goalId, requirementId);
  return { linked: true };
}

export function recordGoalRun(
  db: Database.Database,
  params: {
    goalId: string;
    agentId: string;
    prompt: string;
    ticketId?: string;
    model?: string;
    provider?: string;
    source?: string;
  }
): GoalRunRow {
  if (!getGoal(db, params.goalId)) throw new Error(`Goal '${params.goalId}' not found`);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pm_goal_runs (id, goal_id, agent_id, ticket_id, prompt, model, provider, source, outcome, summary, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', '', datetime('now'))`
  ).run(
    id,
    params.goalId,
    params.agentId,
    params.ticketId ?? null,
    params.prompt,
    params.model ?? '',
    params.provider ?? '',
    params.source ?? 'mcp'
  );
  // Launching work moves an idle goal into in_progress
  db.prepare(
    `UPDATE pm_goals SET status = 'in_progress', updated_at = datetime('now')
     WHERE id = ? AND status IN ('draft', 'active')`
  ).run(params.goalId);
  return db.prepare('SELECT * FROM pm_goal_runs WHERE id = ?').get(id) as GoalRunRow;
}

export function completeGoalRun(
  db: Database.Database,
  runId: string,
  outcome: string,
  summary?: string
): GoalRunRow {
  const changes = db
    .prepare(
      `UPDATE pm_goal_runs SET outcome = ?, summary = COALESCE(?, summary), finished_at = datetime('now') WHERE id = ?`
    )
    .run(outcome, summary ?? null, runId).changes;
  if (changes === 0) throw new Error(`Goal run '${runId}' not found`);
  return db.prepare('SELECT * FROM pm_goal_runs WHERE id = ?').get(runId) as GoalRunRow;
}

export function listGoalRuns(db: Database.Database, goalId: string): GoalRunRow[] {
  return db
    .prepare('SELECT * FROM pm_goal_runs WHERE goal_id = ? ORDER BY started_at DESC, id')
    .all(goalId) as GoalRunRow[];
}

function descendantIds(db: Database.Database, goalId: string): string[] {
  // Recursive CTE walks the subtree in one query; cycle-safe via UNION dedup.
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM pm_goals WHERE id = ?
         UNION
         SELECT g.id FROM pm_goals g JOIN subtree s ON g.parent_id = s.id
       )
       SELECT id FROM subtree`
    )
    .all(goalId) as { id: string }[];
  return rows.map((r) => r.id);
}

export function evaluateGoal(
  db: Database.Database,
  goalId: string
): {
  satisfied: boolean;
  blockers: string[];
  progress: { totalTickets: number; doneTickets: number };
} {
  if (!getGoal(db, goalId)) throw new Error(`Goal '${goalId}' not found`);
  const blockers: string[] = [];
  const subtree = descendantIds(db, goalId);
  const placeholders = subtree.map(() => '?').join(',');

  const tickets = db
    .prepare(`SELECT id, name, status FROM pm_tickets WHERE goal_id IN (${placeholders})`)
    .all(...subtree) as { id: string; name: string; status: string }[];
  for (const t of tickets) {
    if (t.status !== 'done') blockers.push(`Ticket ${t.id} "${t.name}" is ${t.status}`);
  }

  const reqs = db
    .prepare(
      `SELECT r.req_id, r.status FROM pm_goal_requirement_links l
       JOIN pm_requirements r ON r.id = l.requirement_id WHERE l.goal_id = ?`
    )
    .all(goalId) as { req_id: string; status: string }[];
  for (const r of reqs) {
    if (r.status !== 'verified') {
      blockers.push(`Requirement ${r.req_id} is ${r.status}, not verified`);
    }
  }

  const children = db
    .prepare('SELECT name, status FROM pm_goals WHERE parent_id = ?')
    .all(goalId) as { name: string; status: string }[];
  for (const c of children) {
    if (c.status !== 'achieved') {
      blockers.push(`Sub-goal "${c.name}" is ${c.status}, not achieved`);
    }
  }

  // A goal with nothing attached is vacuously "true" but not meaningfully
  // achieved — refuse to report it as satisfied.
  if (tickets.length === 0 && reqs.length === 0 && children.length === 0) {
    blockers.push('Goal has no tickets, requirements, or sub-goals — nothing to verify');
  }

  return {
    satisfied: blockers.length === 0,
    blockers,
    progress: {
      totalTickets: tickets.length,
      doneTickets: tickets.filter((t) => t.status === 'done').length,
    },
  };
}

export function registerGoalTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_goals',
    description:
      'List goals (the declarative layer above tickets: desired world states with machine-checkable success criteria). Optionally filter by status or parent.',
    parameters: z.object({
      status: z
        .enum(['draft', 'active', 'in_progress', 'achieved', 'failed', 'archived'])
        .optional()
        .describe('Filter by goal status'),
      parentId: z.string().optional().describe('Only children of this goal (UUID or prefix)'),
    }),
    execute: async ({ status, parentId }) => {
      const filters: { status?: string; parentId?: string } = {};
      if (status) filters.status = status;
      if (parentId) filters.parentId = resolveGoalId(db, parentId);
      return JSON.stringify(listGoals(db, filters));
    },
  });

  server.addTool({
    name: 'get_goal',
    description: 'Get a single goal by UUID or unique prefix, including its runs',
    parameters: z.object({
      id: z.string().describe('Goal ID (UUID or unique prefix)'),
    }),
    execute: async ({ id }) => {
      const resolved = resolveGoalId(db, id);
      const goal = getGoal(db, resolved);
      if (!goal) return JSON.stringify({ error: 'Goal not found' });
      return JSON.stringify({ ...goal, runs: listGoalRuns(db, resolved) }, null, 2);
    },
  });

  server.addTool({
    name: 'get_goal_tree',
    description:
      'Get the full goal hierarchy as a nested tree with attached ticket summaries. Pass rootId to scope to one subtree.',
    parameters: z.object({
      rootId: z.string().optional().describe('Optional root goal ID (UUID or prefix)'),
    }),
    execute: async ({ rootId }) => {
      const resolved = rootId ? resolveGoalId(db, rootId) : undefined;
      return JSON.stringify(getGoalTree(db, resolved), null, 2);
    },
  });

  server.addTool({
    name: 'create_goal',
    description:
      'Create a goal: a desired world state with success criteria. Use parentId to attach as sub-goal.',
    parameters: z.object({
      name: z.string().describe('Short goal name'),
      parentId: z.string().optional().describe('Parent goal ID for sub-goals (UUID or prefix)'),
      description: z.string().optional().describe('Full markdown description'),
      successCriteria: z
        .string()
        .optional()
        .describe('Machine-checkable markdown checklist defining "achieved"'),
      status: z
        .enum(['draft', 'active', 'in_progress', 'achieved', 'failed', 'archived'])
        .optional()
        .describe('Initial status (default draft)'),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      goalPrompt: z
        .string()
        .optional()
        .describe('Canonical prompt used when launching agents for this goal'),
      sortOrder: z.number().optional(),
    }),
    execute: async (params) => {
      const parentId = params.parentId ? resolveGoalId(db, params.parentId) : undefined;
      return JSON.stringify(createGoal(db, { ...params, parentId }, 'mcp'));
    },
  });

  server.addTool({
    name: 'update_goal',
    description: 'Update fields of an existing goal. Setting status=achieved stamps achieved_at.',
    parameters: z.object({
      id: z.string().describe('Goal ID (UUID or prefix)'),
      name: z.string().optional(),
      parentId: z.string().nullable().optional().describe('New parent (null to make root)'),
      description: z.string().optional(),
      successCriteria: z.string().optional(),
      status: z
        .enum(['draft', 'active', 'in_progress', 'achieved', 'failed', 'archived'])
        .optional(),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      goalPrompt: z.string().optional(),
      sortOrder: z.number().optional(),
    }),
    execute: async ({ id, ...updates }) => {
      const resolved = resolveGoalId(db, id);
      const parentId =
        typeof updates.parentId === 'string'
          ? resolveGoalId(db, updates.parentId)
          : updates.parentId;
      return JSON.stringify(updateGoal(db, resolved, { ...updates, parentId }));
    },
  });

  server.addTool({
    name: 'delete_goal',
    description: 'Delete a goal and (via cascade) its entire subtree, runs, and requirement links',
    parameters: z.object({
      id: z.string().describe('Goal ID (UUID or prefix)'),
    }),
    execute: async ({ id }) => {
      const resolved = resolveGoalId(db, id);
      return JSON.stringify({ deleted: deleteGoal(db, resolved) });
    },
  });

  server.addTool({
    name: 'decompose_goal',
    description:
      'Decompose a goal into sub-goals in one atomic step (the orchestrator use case). Children are created with status=active.',
    parameters: z.object({
      parentId: z.string().describe('Goal to decompose (UUID or prefix)'),
      children: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            successCriteria: z.string().optional(),
            priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
            goalPrompt: z.string().optional(),
          })
        )
        .min(1)
        .describe('Sub-goals to create'),
    }),
    execute: async ({ parentId, children }) => {
      const resolved = resolveGoalId(db, parentId);
      return JSON.stringify(decomposeGoal(db, resolved, children, 'mcp'));
    },
  });

  server.addTool({
    name: 'link_ticket_to_goal',
    description: 'Attach a ticket to a goal (or detach with goalId=null)',
    parameters: z.object({
      ticketId: z.string().describe('Ticket ID (UUID or prefix)'),
      goalId: z.string().nullable().describe('Goal ID (UUID or prefix), or null to detach'),
    }),
    execute: async ({ ticketId, goalId }) => {
      const ticket = resolveTicketId(db, ticketId);
      const goal = goalId === null ? null : resolveGoalId(db, goalId);
      return JSON.stringify(linkTicketToGoal(db, ticket, goal));
    },
  });

  server.addTool({
    name: 'link_requirement_to_goal',
    description:
      'Link a requirement (application invariant) to a goal. The goal only counts as satisfied when the requirement is verified.',
    parameters: z.object({
      goalId: z.string().describe('Goal ID (UUID or prefix)'),
      requirementId: z.string().describe('Requirement ID (UUID, prefix, or req_id)'),
    }),
    execute: async ({ goalId, requirementId }) => {
      const goal = resolveGoalId(db, goalId);
      const req = resolveRequirementId(db, requirementId);
      return JSON.stringify(linkRequirementToGoal(db, goal, req));
    },
  });

  server.addTool({
    name: 'record_goal_run',
    description:
      'Record that an agent was launched for a goal. Stores the exact prompt as a first-class artifact and moves the goal to in_progress.',
    parameters: z.object({
      goalId: z.string().describe('Goal ID (UUID or prefix)'),
      agentId: z.string().describe('The launched agent ID'),
      prompt: z.string().describe('The exact prompt the agent was launched with'),
      ticketId: z.string().optional().describe('Ticket the run works on, if any'),
      model: z.string().optional(),
      provider: z.string().optional(),
    }),
    execute: async (params) => {
      const goalId = resolveGoalId(db, params.goalId);
      return JSON.stringify(recordGoalRun(db, { ...params, goalId, source: 'mcp' }));
    },
  });

  server.addTool({
    name: 'complete_goal_run',
    description: 'Mark a goal run as finished with an outcome and optional summary',
    parameters: z.object({
      runId: z.string().describe('Goal run ID'),
      outcome: z.enum(['completed', 'failed', 'killed']),
      summary: z.string().optional().describe('What the run produced'),
    }),
    execute: async ({ runId, outcome, summary }) =>
      JSON.stringify(completeGoalRun(db, runId, outcome, summary)),
  });

  server.addTool({
    name: 'evaluate_goal',
    description:
      'Machine-check a goal: reports satisfied/blockers from ticket statuses (whole subtree), linked requirement verification, and child goal achievement. Use before marking a goal achieved.',
    parameters: z.object({
      id: z.string().describe('Goal ID (UUID or prefix)'),
    }),
    execute: async ({ id }) => {
      const resolved = resolveGoalId(db, id);
      return JSON.stringify(evaluateGoal(db, resolved), null, 2);
    },
  });
}

import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { resolveGoalId, resolveRequirementId, resolveTicketId } from './resolve';
import {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  decomposeGoal,
  getGoalTree,
  linkTicketToGoal,
  linkRequirementToGoal,
  recordGoalRun,
  completeGoalRun,
  listGoalRuns,
  evaluateGoal,
} from './goalsDb';

export * from './goalsDb';

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

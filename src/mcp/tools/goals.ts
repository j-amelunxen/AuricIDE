import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { GOAL_WORK_MODE_SETTINGS } from '../../lib/goals/workMode';
import { GOAL_STATUSES } from '../../lib/pm/enums';
import { resolveEpicId, resolveGoalId, resolveRequirementId, resolveTicketId } from './resolve';
import {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  decomposeGoal,
  materializeGoalPlan,
  getGoalTree,
  linkTicketToGoal,
  linkRequirementToGoal,
  recordGoalRun,
  completeGoalRun,
  listGoalRuns,
  evaluateGoal,
  addGoalDependency,
  removeGoalDependency,
  listGoalDependencies,
  goalDependsOnIds,
  goalBlockedByInfo,
} from './goalsDb';

export * from './goalsDb';

const MISSION_PATH_DESCRIPTION =
  'Root goals only: the mission folder this goal stands for, relative to the project ' +
  '(e.g. "missions/<slug>"). The goal view then shows the mission\'s phases, open questions ' +
  'and reviews from <folder>/shared.';

const WORK_MODE_PARAM = z
  .enum(GOAL_WORK_MODE_SETTINGS)
  .optional()
  .describe(
    'How the goal is worked: "stations" (one goal agent works the stations and marks each done ' +
      'with evidence, no tickets), "tickets" (epic + tickets, conductor per ticket) or "auto" ' +
      '(default: stations when the goal has stations and no tickets, else tickets)'
  );

// code-gate: complexity-function-length - a flat MCP tool registration list (one server.addTool block per tool); splitting it up would only move each block into its own function, scattering the one place that lists every goal tool the server exposes
export function registerGoalTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'list_goals',
    description:
      'List goals (the declarative layer above tickets: desired world states with machine-checkable success criteria). Optionally filter by status or parent.',
    parameters: z.object({
      status: z.enum(GOAL_STATUSES).optional().describe('Filter by goal status'),
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
    description:
      'Get a single goal by UUID or unique prefix, including its runs, bundle, the goals it depends on, and what is currently blocking it',
    parameters: z.object({
      id: z.string().describe('Goal ID (UUID or unique prefix)'),
    }),
    execute: async ({ id }) => {
      const resolved = resolveGoalId(db, id);
      const goal = getGoal(db, resolved);
      if (!goal) return JSON.stringify({ error: 'Goal not found' });
      return JSON.stringify(
        {
          ...goal,
          dependsOn: goalDependsOnIds(db, resolved),
          blockedBy: goalBlockedByInfo(db, resolved),
          runs: listGoalRuns(db, resolved),
        },
        null,
        2
      );
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
      status: z.enum(GOAL_STATUSES).optional().describe('Initial status (default draft)'),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      goalPrompt: z
        .string()
        .optional()
        .describe('Canonical prompt used when launching agents for this goal'),
      sortOrder: z.number().optional(),
      workMode: WORK_MODE_PARAM,
      missionPath: z.string().optional().describe(MISSION_PATH_DESCRIPTION),
      bundle: z
        .string()
        .optional()
        .describe(
          'Groups this goal with its siblings (same parent) that share the same label: they only ' +
            'become achieved together, once every member has met its own conditions. A dependency ' +
            'onto one member is a dependency onto the whole bundle.'
        ),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe(
          'Goals this one must wait for: an exact goal id, a unique id prefix, or the exact name of ' +
            'a sibling (same parent). Blocked until every target reaches achieved or archived; a ' +
            'failed target keeps blocking. Rejected if it would create a cycle or cross into an ' +
            "ancestor, descendant, or this goal's own bundle."
        ),
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
      status: z.enum(GOAL_STATUSES).optional(),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
      goalPrompt: z.string().optional(),
      sortOrder: z.number().optional(),
      workMode: WORK_MODE_PARAM,
      missionPath: z
        .string()
        .nullable()
        .optional()
        .describe(`${MISSION_PATH_DESCRIPTION} null or "" removes the link.`),
      bundle: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Bundle label shared with siblings that must become achieved together; null or "" removes ' +
            'this goal from its bundle.'
        ),
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
      'Decompose a goal into sub-goals in one atomic step (the orchestrator use case). Children are ' +
      'created with status=active, in the given order, after any existing children.',
    parameters: z.object({
      parentId: z.string().describe('Goal to decompose (UUID or prefix)'),
      mode: z
        .enum(['parallel', 'serial'])
        .optional()
        .describe(
          'Default "parallel": children only wait on what their own dependsOn names. "serial" ' +
            'additionally chains each child after the previous one in the listed order, on top of ' +
            'any explicit dependsOn — use it for a simple A-then-B-then-C line.'
        ),
      children: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            successCriteria: z.string().optional(),
            priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
            goalPrompt: z.string().optional(),
            key: z
              .string()
              .optional()
              .describe(
                "A local label for this child, usable by another child's dependsOn within this same " +
                  'call — checked before goal ids or sibling names, and cleared once the call returns.'
              ),
            dependsOn: z
              .array(z.string())
              .optional()
              .describe(
                "What this child must wait for: a key from this same call, or an existing goal's " +
                  'id, unique id prefix, or exact sibling name. Blocked until every target reaches ' +
                  'achieved or archived.'
              ),
            bundle: z
              .string()
              .optional()
              .describe(
                'Groups this child with siblings that share the label: they become achieved only ' +
                  'together, once every member has met its own conditions.'
              ),
          })
        )
        .min(1)
        .describe('Sub-goals to create'),
    }),
    execute: async ({ parentId, children, mode }) => {
      const resolved = resolveGoalId(db, parentId);
      return JSON.stringify(decomposeGoal(db, resolved, children, 'mcp', mode ?? 'parallel'));
    },
  });

  server.addTool({
    name: 'materialize_goal_plan',
    description:
      'Idempotently and atomically materialize a meta-goal plan. Exact child-goal name plus ticket name is the package identity: existing pairs are returned unchanged, missing tickets are added to existing matching children, and new pairs are created only when missing. Duplicate or ambiguous child names are rejected. If any package fails, nothing is created.',
    parameters: z.object({
      parentId: z.string().describe('Meta-goal ID (UUID or unique prefix)'),
      epicId: z.string().describe('Existing epic for all created tickets (UUID or unique prefix)'),
      workPackages: z
        .array(
          z.object({
            goal: z.object({
              name: z.string(),
              description: z.string().optional(),
              successCriteria: z.string().optional(),
              priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
              goalPrompt: z.string().optional(),
            }),
            ticket: z.object({
              name: z.string(),
              description: z.string().optional(),
              priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
              dueDate: z.string().nullable().optional(),
              needsHumanSupervision: z.boolean().optional(),
              skills: z.array(z.string()).optional(),
            }),
          })
        )
        .min(1),
    }),
    execute: async ({ parentId, epicId, workPackages }) => {
      const resolvedParentId = resolveGoalId(db, parentId);
      const resolvedEpicId = resolveEpicId(db, epicId);
      return JSON.stringify(
        materializeGoalPlan(db, resolvedParentId, resolvedEpicId, workPackages, 'mcp')
      );
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
      'Machine-check a goal: reports satisfied/blockers from ticket statuses (whole subtree), linked requirement verification, station evidence and child goal achievement, plus workMode (stations or tickets, and why) and completion (achievable + blockers: the same rule the IDE uses to achieve a goal, with or without tickets). Use before marking a goal achieved.',
    parameters: z.object({
      id: z.string().describe('Goal ID (UUID or prefix)'),
    }),
    execute: async ({ id }) => {
      const resolved = resolveGoalId(db, id);
      return JSON.stringify(evaluateGoal(db, resolved), null, 2);
    },
  });

  server.addTool({
    name: 'add_goal_dependency',
    description:
      'Add a wait-for edge: goalId (and its whole subtree) stays blocked until dependsOnGoalId reaches ' +
      'achieved or archived (a failed target keeps blocking). A dependency onto a bundled goal applies ' +
      'to every member of its bundle. Rejected — without changing anything — if the edge would create a ' +
      'cycle, target an ancestor or descendant of goalId, or cross into its own bundle. Adding an edge ' +
      'that already exists is a no-op.',
    parameters: z.object({
      goalId: z.string().describe('The goal that will wait (UUID or prefix)'),
      dependsOnGoalId: z.string().describe('The goal it waits for (UUID or prefix)'),
    }),
    execute: async ({ goalId, dependsOnGoalId }) => {
      const from = resolveGoalId(db, goalId);
      const to = resolveGoalId(db, dependsOnGoalId);
      return JSON.stringify(addGoalDependency(db, from, to));
    },
  });

  server.addTool({
    name: 'remove_goal_dependency',
    description: 'Remove a wait-for edge between two goals, if it exists. Never rejected.',
    parameters: z.object({
      goalId: z.string().describe('The waiting goal (UUID or prefix)'),
      dependsOnGoalId: z
        .string()
        .describe('The goal it should no longer wait for (UUID or prefix)'),
    }),
    execute: async ({ goalId, dependsOnGoalId }) => {
      const from = resolveGoalId(db, goalId);
      const to = resolveGoalId(db, dependsOnGoalId);
      return JSON.stringify(removeGoalDependency(db, from, to));
    },
  });

  server.addTool({
    name: 'list_goal_dependencies',
    description:
      "Inspect the dependency graph. Pass parentId to see one parent's children as topological waves " +
      '(each inner array of goal ids can run in parallel; later arrays wait on something in an earlier ' +
      "one; bundle members always share a wave) plus that scope's edges, bundles and blocked children. " +
      'Pass goalId instead to see just that one goal: the edges touching it, its own bundle, and whether ' +
      'it is currently blocked. Pass neither for every edge, bundle and blocked goal in the project (no ' +
      'waves — those need a parent to be meaningful).',
    parameters: z.object({
      goalId: z.string().optional().describe('Scope to one goal (UUID or prefix)'),
      parentId: z
        .string()
        .optional()
        .describe("Scope to one parent's children, with topological waves (UUID or prefix)"),
    }),
    execute: async ({ goalId, parentId }) => {
      const scope: { goalId?: string; parentId?: string } = {};
      if (goalId) scope.goalId = resolveGoalId(db, goalId);
      if (parentId) scope.parentId = resolveGoalId(db, parentId);
      return JSON.stringify(listGoalDependencies(db, scope), null, 2);
    },
  });
}

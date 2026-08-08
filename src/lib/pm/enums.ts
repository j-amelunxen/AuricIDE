/**
 * The vocabulary of project state, defined once.
 *
 * These values cross a boundary: the UI writes them, and so does every AI agent
 * through the MCP tools. Anything that is not in these lists is not a state the
 * app can reason about — a ticket saved as "Done" instead of "done" is invisible
 * to the conductor, never counts toward a goal, and shows as unfinished forever,
 * with nothing anywhere reporting a problem. So the lists live here, the
 * TypeScript types derive from them, and the MCP schemas validate against them.
 */

export const TICKET_STATUSES = ['open', 'in_progress', 'done', 'archived'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const GOAL_STATUSES = [
  'draft',
  'active',
  'in_progress',
  'achieved',
  'failed',
  'archived',
] as const;
export type GoalStatusValue = (typeof GOAL_STATUSES)[number];

export const REQUIREMENT_STATUSES = [
  'draft',
  'active',
  'implemented',
  'verified',
  'deprecated',
] as const;
export type RequirementStatusValue = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_TYPES = ['functional', 'non_functional'] as const;
export type RequirementTypeValue = (typeof REQUIREMENT_TYPES)[number];

export const MODEL_POWERS = ['low', 'medium', 'high'] as const;
export type ModelPower = (typeof MODEL_POWERS)[number];

/**
 * Guards a value coming across a boundary (MCP tool call, imported document).
 * The message names the field, what arrived and what was allowed, so a contract
 * violation is located precisely instead of surfacing later as missing work.
 */
export function assertOneOf<T extends string>(
  field: string,
  value: string,
  allowed: readonly T[]
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `Invalid ${field}: received "${value}", expected one of ${allowed.map((v) => `"${v}"`).join(', ')}`
  );
}

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

// 'in_review' sits between in_progress and done: an implementer finished, but
// an independent judge has not signed the work off yet. The conductor owns the
// transition; a ticket in review is still work-in-flight, never satisfied.
export const TICKET_STATUSES = ['open', 'in_progress', 'in_review', 'done', 'archived'] as const;
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

// --- Goal line stations ---
// A station's stored status is only done|planned|fog: "front" is derived by
// the layout, never persisted, so no writer has to maintain an
// exactly-one-front invariant.
export const STATION_KINDS = ['normal', 'gate', 'human'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

export const STATION_STATUSES = ['done', 'planned', 'fog'] as const;
export type StationStoredStatus = (typeof STATION_STATUSES)[number];

// How sure we are a station's "done" is real. `claim` is the only class an
// agent can ever write (enforced at the MCP boundary); `proof` and `judged`
// are reserved for the evidence engine, `human` for a person's tick.
export const EVIDENCE_KINDS = ['proof', 'judged', 'claim', 'human'] as const;
export type EvidenceKindValue = (typeof EVIDENCE_KINDS)[number];

// The evidence classes that let a done station count toward goal satisfaction.
// A bare `claim` (an agent's unproven assertion) is deliberately absent: it
// must be promoted by the judge, the evidence engine, or a person first. This
// one constant is imported by BOTH satisfaction twins (getGoalSatisfaction and
// evaluateGoal) so the rule cannot drift between the frontend and the MCP server.
export const VERIFIED_EVIDENCE_KINDS = ['proof', 'judged', 'human'] as const;
export function isVerifiedEvidence(kind: string): boolean {
  return (VERIFIED_EVIDENCE_KINDS as readonly string[]).includes(kind);
}

export const STATION_PREDICATE_TYPES = [
  'undefined',
  'human',
  'ticket_done',
  'requirement_verified',
  'file_exists',
  'git_touches',
  'judged',
] as const;

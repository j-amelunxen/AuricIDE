import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import {
  GOAL_REVIEW_VERDICTS,
  decideGoalReview,
  type GoalReviewDecision,
  type GoalReviewVerdict,
} from '../../lib/goals/goalReviewDecision';
import { resolveGoalId } from './resolve';

/**
 * A reviewer's verdict on a whole goal, stored with its rating.
 *
 * The parameters mirror the reviewer's output schema (mission-goal-review's
 * review-schema.json): `reason` is its summary, `reworkSteps` its rework_steps.
 * The decision is not the reviewer's to make — `decideGoalReview` makes it from
 * what is stored here, and the row keeps both so a later reader sees who said
 * what. Ticket reviews (`submit_ticket_review`) are a different table and stay
 * as they are.
 */

const score = z.number().int().min(1).max(5);

export const goalReviewParams = z.object({
  goalId: z.string().min(1).describe('Goal ID (UUID or unique prefix)'),
  verdict: z
    .enum(GOAL_REVIEW_VERDICTS)
    .describe('approve: done and good. rework: fixable gaps. escalate: needs a person.'),
  scores: z
    .object({
      criteria_met: score.describe('Success criteria met, with evidence checked (1-5)'),
      solves_problem: score.describe('Solves the problem behind the goal (1-5)'),
      solution_quality: score.describe('Solved sensibly, no shortcuts (1-5)'),
      scope_respected: score.describe('Non-goals and rules respected (1-5)'),
    })
    .strict(),
  reason: z
    .string()
    .trim()
    .min(1, 'A goal review must include a reason')
    .describe('Why this verdict: what was built and whether it solves the problem'),
  criteria: z
    .array(
      z
        .object({
          criterion: z.string().min(1),
          met: z.enum(['yes', 'no', 'unclear', 'human_pending']),
          evidence: z.string(),
        })
        .strict()
    )
    .describe('One entry per success criterion of the goal, in order'),
  findings: z
    .array(
      z
        .object({
          severity: z.enum(['blocker', 'major', 'minor']),
          what: z.string().min(1),
          where: z.string(),
          why: z.string(),
          scope: z.enum(['in_goal', 'follow_up']),
        })
        .strict()
    )
    .describe('Findings; only in_goal ones count against the goal'),
  reworkSteps: z
    .array(z.string().trim().min(1))
    .describe('Concrete, ordered steps for the in_goal findings; empty on approve'),
  reviewer: z.string().trim().min(1).default('codex').describe('Who reviewed (default codex)'),
});

export type GoalReviewParams = z.input<typeof goalReviewParams>;

export interface GoalReviewRow {
  id: string;
  goal_id: string;
  verdict: GoalReviewVerdict;
  decision: GoalReviewDecision;
  criteria_met: number;
  solves_problem: number;
  solution_quality: number;
  scope_respected: number;
  reason: string;
  criteria: string;
  findings: string;
  rework_steps: string;
  reviewer: string;
  attempt: number;
  created_at: string;
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Validates against the same schema the MCP tool publishes, so a call from the
 * UI, a script or an agent meets one contract. The message names the field.
 */
function parseParams(input: GoalReviewParams) {
  const parsed = goalReviewParams.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid goal review: ${issues}`);
}

export function submitGoalReview(db: Database.Database, input: GoalReviewParams): GoalReviewRow {
  const params = parseParams(input);
  const goal = db.prepare('SELECT id FROM pm_goals WHERE id = ?').get(params.goalId);
  if (!goal) throw new Error(`Goal not found: ${params.goalId}`);

  const id = crypto.randomUUID();
  // Read the attempt and insert in one transaction: two reviewers finishing at
  // once must not both become attempt 2 (the UNIQUE index would refuse one).
  db.transaction(() => {
    const { last } = db
      .prepare('SELECT COALESCE(MAX(attempt), 0) AS last FROM pm_goal_reviews WHERE goal_id = ?')
      .get(params.goalId) as { last: number };
    const attempt = last + 1;
    const { decision } = decideGoalReview(
      {
        verdict: params.verdict,
        scores: params.scores,
        criteria: params.criteria,
        findings: params.findings,
      },
      { attempt }
    );
    db.prepare(
      `INSERT INTO pm_goal_reviews (id, goal_id, verdict, decision, criteria_met, solves_problem,
         solution_quality, scope_respected, reason, criteria, findings, rework_steps, reviewer,
         attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.goalId,
      params.verdict,
      decision,
      params.scores.criteria_met,
      params.scores.solves_problem,
      params.scores.solution_quality,
      params.scores.scope_respected,
      params.reason,
      JSON.stringify(params.criteria),
      JSON.stringify(params.findings),
      JSON.stringify(params.reworkSteps),
      params.reviewer,
      attempt,
      now()
    );
  }).immediate();
  return db.prepare('SELECT * FROM pm_goal_reviews WHERE id = ?').get(id) as GoalReviewRow;
}

export function registerGoalReviewTools(server: FastMCP, db: Database.Database): void {
  server.addTool({
    name: 'submit_goal_review',
    description:
      "Record a reviewer's verdict on a whole goal: verdict, four scores (1-5), reason, per-criterion results, findings and rework steps. The attempt number is counted per goal, and the decision (approve/rework/escalate) is made by the goal review rule, not by the reviewer.",
    parameters: goalReviewParams,
    execute: async (params) =>
      JSON.stringify(submitGoalReview(db, { ...params, goalId: resolveGoalId(db, params.goalId) })),
  });
}

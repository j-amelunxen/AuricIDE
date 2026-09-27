/**
 * The decision rule for goal reviews, defined once.
 *
 * A reviewer (Codex by default) hands back a verdict with four scores, the
 * criteria it checked and its findings. What happens to the goal is not the
 * reviewer's call and not the working agent's either: this rule decides. It is
 * strict on purpose — approve only with every criterion met, every score at
 * least 4 and no blocker in the goal's scope. A lenient gate on a long mission
 * accumulates small debts until a later goal breaks on them.
 *
 * It replaces `decide()` in the mission-goal-review skill's `decide.py`; the
 * reasons are worded identically, and `goalReviewDecision.fixtures.json` (cases
 * decided by decide.py itself) keeps the two from drifting apart.
 */

export const GOAL_REVIEW_VERDICTS = ['approve', 'rework', 'escalate'] as const;
export type GoalReviewVerdict = (typeof GOAL_REVIEW_VERDICTS)[number];

export const GOAL_REVIEW_SCORE_KEYS = [
  'criteria_met',
  'solves_problem',
  'solution_quality',
  'scope_respected',
] as const;
export type GoalReviewScoreKey = (typeof GOAL_REVIEW_SCORE_KEYS)[number];
export type GoalReviewScores = Record<GoalReviewScoreKey, number>;

/** Scores run 1..5; below this, a goal is not approved whatever the verdict says. */
export const GOAL_REVIEW_MIN_SCORE = 4;
/** Review rounds before a rework turns into a question for a person. */
export const GOAL_REVIEW_MAX_ATTEMPTS = 3;

/**
 * `human_pending`: a human station covers the criterion and the person has not
 * checked it yet. It does not hold an approval back; the station does.
 */
export type GoalReviewCriterionMet = 'yes' | 'no' | 'unclear' | 'human_pending';

export interface GoalReviewCriterion {
  criterion: string;
  met: GoalReviewCriterionMet;
}

/**
 * `follow_up` findings are valid points beyond the goal's promise and never
 * block it. A finding without a scope counts as `in_goal`.
 */
export interface GoalReviewFinding {
  severity: string;
  scope?: 'in_goal' | 'follow_up';
  what: string;
}

export interface GoalReviewInput {
  verdict: GoalReviewVerdict;
  scores: GoalReviewScores;
  criteria: GoalReviewCriterion[];
  findings: GoalReviewFinding[];
}

export type GoalReviewDecision = GoalReviewVerdict;

export interface GoalReviewOutcome {
  decision: GoalReviewDecision;
  reasons: string[];
}

export interface GoalReviewContext {
  /** 1-based review round of this goal. */
  attempt: number;
  maxAttempts?: number;
  /** Reasons a formal harness gives against closing (empty when green or not required). */
  formalReasons?: string[];
}

function assertWellFormed(review: GoalReviewInput, context: GoalReviewContext) {
  if (!Number.isInteger(context.attempt) || context.attempt < 1) {
    throw new Error(`Invalid attempt: received ${context.attempt}, expected an integer >= 1`);
  }
  for (const key of GOAL_REVIEW_SCORE_KEYS) {
    const score = review.scores[key];
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`Invalid score ${key}: received ${score}, expected an integer 1..5`);
    }
  }
}

/** Everything that stands between this review and an approval, as readable reasons. */
function ruleViolations(review: GoalReviewInput): string[] {
  const reasons: string[] = [];
  const low = GOAL_REVIEW_SCORE_KEYS.filter((key) => review.scores[key] < GOAL_REVIEW_MIN_SCORE);
  const unmet = review.criteria.filter((c) => c.met !== 'yes' && c.met !== 'human_pending');
  const blockers = review.findings.filter(
    (f) => f.severity === 'blocker' && (f.scope ?? 'in_goal') === 'in_goal'
  );
  if (low.length > 0) {
    reasons.push(
      `scores below ${GOAL_REVIEW_MIN_SCORE}: ` +
        low.map((key) => `${key}=${review.scores[key]}`).join(', ')
    );
  }
  if (unmet.length > 0) reasons.push(`${unmet.length} criteria not met or unclear`);
  if (blockers.length > 0) reasons.push(`${blockers.length} blocker finding(s)`);
  return reasons;
}

export function decideGoalReview(
  review: GoalReviewInput,
  context: GoalReviewContext
): GoalReviewOutcome {
  assertWellFormed(review, context);
  const maxAttempts = context.maxAttempts ?? GOAL_REVIEW_MAX_ATTEMPTS;
  const reasons = [...ruleViolations(review), ...(context.formalReasons ?? [])];

  if (review.verdict === 'escalate') {
    return { decision: 'escalate', reasons: [...reasons, 'reviewer escalated to a person'] };
  }
  if (review.verdict === 'approve' && reasons.length === 0) {
    return { decision: 'approve', reasons: ['all criteria met, all scores >= 4, no blocker'] };
  }
  reasons.unshift(
    review.verdict === 'approve'
      ? 'reviewer said approve, but the rule does not allow it'
      : 'reviewer requested rework'
  );
  if (context.attempt >= maxAttempts) {
    return {
      decision: 'escalate',
      reasons: [...reasons, `attempt ${context.attempt} of ${maxAttempts}: rework limit reached`],
    };
  }
  return { decision: 'rework', reasons };
}

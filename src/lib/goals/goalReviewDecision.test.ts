import { describe, expect, it } from 'vitest';
import fixtures from './goalReviewDecision.fixtures.json';
import {
  GOAL_REVIEW_MIN_SCORE,
  GOAL_REVIEW_SCORE_KEYS,
  GOAL_REVIEW_VERDICTS,
  decideGoalReview,
  type GoalReviewCriterionMet,
  type GoalReviewInput,
  type GoalReviewScores,
} from './goalReviewDecision';

const allAt = (value: number): GoalReviewScores =>
  Object.fromEntries(GOAL_REVIEW_SCORE_KEYS.map((key) => [key, value])) as GoalReviewScores;

function review(overrides: Partial<GoalReviewInput> = {}): GoalReviewInput {
  return {
    verdict: 'approve',
    scores: allAt(5),
    criteria: [{ criterion: 'K1', met: 'yes' }],
    findings: [],
    ...overrides,
  };
}

describe('decideGoalReview: examples', () => {
  it('approves a clean approve', () => {
    expect(decideGoalReview(review(), { attempt: 1 })).toEqual({
      decision: 'approve',
      reasons: ['all criteria met, all scores >= 4, no blocker'],
    });
  });

  it('overrules an approve that carries a score below 4', () => {
    const result = decideGoalReview(review({ scores: { ...allAt(5), solution_quality: 3 } }), {
      attempt: 1,
    });
    expect(result).toEqual({
      decision: 'rework',
      reasons: [
        'reviewer said approve, but the rule does not allow it',
        'scores below 4: solution_quality=3',
      ],
    });
  });

  it('counts a human-pending criterion as met and an unclear one as not met', () => {
    const pending = review({
      criteria: [
        { criterion: 'K1', met: 'yes' },
        { criterion: 'K2', met: 'human_pending' },
      ],
    });
    expect(decideGoalReview(pending, { attempt: 1 }).decision).toBe('approve');
    const unclear = review({ criteria: [{ criterion: 'K1', met: 'unclear' }] });
    expect(decideGoalReview(unclear, { attempt: 1 }).reasons).toContain(
      '1 criteria not met or unclear'
    );
  });

  it('lets a follow-up blocker through, but not one without scope', () => {
    const followUp = review({
      findings: [{ severity: 'blocker', scope: 'follow_up', what: 'F1' }],
    });
    expect(decideGoalReview(followUp, { attempt: 1 }).decision).toBe('approve');
    const unscoped = review({ findings: [{ severity: 'blocker', what: 'F1' }] });
    expect(decideGoalReview(unscoped, { attempt: 1 }).reasons).toContain('1 blocker finding(s)');
  });

  it('escalates a rework once the attempt limit is reached', () => {
    const result = decideGoalReview(review({ verdict: 'rework' }), { attempt: 3 });
    expect(result).toEqual({
      decision: 'escalate',
      reasons: ['reviewer requested rework', 'attempt 3 of 3: rework limit reached'],
    });
  });

  it('blocks an approve while the formal harness is red', () => {
    const result = decideGoalReview(review(), {
      attempt: 1,
      formalReasons: ['Lean harness not green (red)'],
    });
    expect(result.decision).toBe('rework');
    expect(result.reasons).toContain('Lean harness not green (red)');
  });

  it('rejects an attempt below 1 and a score outside 1..5', () => {
    expect(() => decideGoalReview(review(), { attempt: 0 })).toThrow(/attempt/);
    expect(() =>
      decideGoalReview(review({ scores: { ...allAt(5), scope_respected: 6 } }), { attempt: 1 })
    ).toThrow(/scope_respected/);
  });
});

// The whole input space the rule can distinguish, enumerated rather than sampled:
// verdict x each score on either side of the threshold x criteria x findings x
// attempt. Small enough to walk completely, so a property holds everywhere.
const CRITERIA: GoalReviewCriterionMet[][] = [
  [],
  ['yes'],
  ['yes', 'human_pending'],
  ['no'],
  ['unclear'],
];
const FINDINGS: GoalReviewInput['findings'][] = [
  [],
  [{ severity: 'blocker', scope: 'in_goal', what: 'F' }],
  [{ severity: 'blocker', scope: 'follow_up', what: 'F' }],
  [{ severity: 'major', scope: 'in_goal', what: 'F' }],
];

function* space() {
  const scoreSets = Array.from(
    { length: 16 },
    (_, mask) =>
      Object.fromEntries(
        GOAL_REVIEW_SCORE_KEYS.map((key, i) => [key, mask & (1 << i) ? 3 : 4])
      ) as GoalReviewScores
  );
  for (const verdict of GOAL_REVIEW_VERDICTS)
    for (const scores of scoreSets)
      for (const met of CRITERIA)
        for (const findings of FINDINGS)
          for (const attempt of [1, 2, 3, 4])
            for (const formalReasons of [[], ['harness red']]) {
              const input: GoalReviewInput = {
                verdict,
                scores,
                criteria: met.map((m, i) => ({ criterion: `K${i}`, met: m })),
                findings,
              };
              yield { input, attempt, formalReasons };
            }
}

const isClean = (input: GoalReviewInput, formalReasons: string[]) =>
  GOAL_REVIEW_SCORE_KEYS.every((key) => input.scores[key] >= GOAL_REVIEW_MIN_SCORE) &&
  input.criteria.every((c) => c.met === 'yes' || c.met === 'human_pending') &&
  !input.findings.some((f) => f.severity === 'blocker' && (f.scope ?? 'in_goal') === 'in_goal') &&
  formalReasons.length === 0;

describe('decideGoalReview: properties over the whole space', () => {
  it('approves exactly when the reviewer approves and nothing stands in the way', () => {
    for (const { input, attempt, formalReasons } of space()) {
      const { decision } = decideGoalReview(input, { attempt, formalReasons });
      const shouldApprove = input.verdict === 'approve' && isClean(input, formalReasons);
      expect(decision === 'approve', JSON.stringify({ input, attempt })).toBe(shouldApprove);
    }
  });

  it('never approves against the reviewer, and always escalates an escalation', () => {
    for (const { input, attempt, formalReasons } of space()) {
      const { decision } = decideGoalReview(input, { attempt, formalReasons });
      if (input.verdict !== 'approve') expect(decision).not.toBe('approve');
      if (input.verdict === 'escalate') expect(decision).toBe('escalate');
    }
  });

  it('never sends work back once the attempt limit is reached', () => {
    for (const { input, attempt, formalReasons } of space()) {
      const { decision } = decideGoalReview(input, { attempt, formalReasons });
      if (attempt >= 3) expect(decision).not.toBe('rework');
      if (attempt < 3 && input.verdict === 'rework') expect(decision).toBe('rework');
    }
  });

  it('gives a reason for every decision', () => {
    for (const { input, attempt, formalReasons } of space()) {
      expect(decideGoalReview(input, { attempt, formalReasons }).reasons.length).toBeGreaterThan(0);
    }
  });

  it('is monotone: lowering a score never turns a non-approve into an approve', () => {
    for (const { input, attempt, formalReasons } of space()) {
      if (decideGoalReview(input, { attempt, formalReasons }).decision === 'approve') continue;
      for (const key of GOAL_REVIEW_SCORE_KEYS) {
        const lower = { ...input, scores: { ...input.scores, [key]: 1 } };
        expect(decideGoalReview(lower, { attempt, formalReasons }).decision).not.toBe('approve');
      }
    }
  });
});

describe('decideGoalReview: same decisions as decide.py', () => {
  // Expected values come from decide() in the mission-goal-review skill, generated
  // by missions/goal-native/shared/artifacts/02-review-daten/decide_cases.py.
  // Never edit them by hand: regenerate from decide.py.
  it.each(fixtures.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const result = decideGoalReview(c.review as GoalReviewInput, {
      attempt: c.attempt,
      maxAttempts: c.maxAttempts,
      formalReasons: c.formalReasons,
    });
    expect(result).toEqual(c.expected);
  });

  it('carries every decision in the shared file', () => {
    const decisions = new Set(fixtures.cases.map((c) => c.expected.decision));
    expect([...decisions].sort()).toEqual(['approve', 'escalate', 'rework']);
  });
});

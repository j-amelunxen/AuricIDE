import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../db';
import { createGoal } from '../tools/goalsDb';
import {
  registerGoalReviewTools,
  submitGoalReview,
  type GoalReviewParams,
} from '../tools/goalReviews';

// Contract tests for submit_goal_review. They go through the tool exactly as an
// MCP client reaches it: the schema FastMCP publishes, then execute().

interface RegisteredTool {
  name: string;
  parameters: { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
  execute: (params: unknown) => Promise<string>;
}

function registeredTool(db: Database.Database): RegisteredTool {
  const addTool = vi.spyOn(FastMCP.prototype, 'addTool');
  registerGoalReviewTools(new FastMCP({ name: 'test', version: '1.0.0' }), db);
  const tool = addTool.mock.calls
    .map(([t]) => t as unknown as RegisteredTool)
    .find((t) => t.name === 'submit_goal_review');
  addTool.mockRestore();
  if (!tool) throw new Error('submit_goal_review was not registered');
  return tool;
}

/** Validate like the MCP layer does, then run: a rejected payload never reaches execute. */
async function call(tool: RegisteredTool, payload: unknown) {
  const parsed = tool.parameters.safeParse(payload);
  if (!parsed.success) return { rejected: true as const, error: parsed };
  return { rejected: false as const, row: JSON.parse(await tool.execute(parsed.data)) };
}

describe('submit_goal_review', () => {
  let db: Database.Database;
  let goalId: string;
  let tool: RegisteredTool;

  const valid = (overrides: Partial<GoalReviewParams> = {}): GoalReviewParams => ({
    goalId,
    verdict: 'approve',
    scores: { criteria_met: 5, solves_problem: 4, solution_quality: 4, scope_respected: 5 },
    reason: 'Table, tool and rule exist; tests green.',
    criteria: [{ criterion: 'Tabelle pm_goal_reviews', met: 'yes', evidence: 'schema test' }],
    findings: [],
    reworkSteps: [],
    ...overrides,
  });
  const count = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM pm_goal_reviews').get() as { n: number }).n;

  beforeEach(() => {
    db = createTestDb();
    goalId = createGoal(db, { name: 'Goal' }, 'mcp').id;
    tool = registeredTool(db);
  });

  afterEach(() => db.close());

  describe('valid review', () => {
    it('stores verdict, scores, reason, criteria, findings, rework steps, reviewer and attempt', async () => {
      const finding = {
        severity: 'minor' as const,
        what: 'naming',
        where: 'overall',
        why: 'x',
        scope: 'follow_up' as const,
      };
      const result = await call(tool, valid({ findings: [finding] }));
      expect(result.rejected).toBe(false);
      if (result.rejected) return;
      expect(result.row).toMatchObject({
        goal_id: goalId,
        verdict: 'approve',
        decision: 'approve',
        criteria_met: 5,
        solves_problem: 4,
        solution_quality: 4,
        scope_respected: 5,
        reason: 'Table, tool and rule exist; tests green.',
        reviewer: 'codex',
        attempt: 1,
      });
      expect(JSON.parse(result.row.findings)).toEqual([finding]);
      expect(JSON.parse(result.row.criteria)).toEqual(valid().criteria);
      expect(JSON.parse(result.row.rework_steps)).toEqual([]);
      expect(count()).toBe(1);
    });

    it('counts attempts per goal and lets the rule, not the reviewer, decide', async () => {
      const first = await call(
        tool,
        valid({ scores: { ...valid().scores, solution_quality: 3 }, reworkSteps: ['fix it'] })
      );
      const second = await call(tool, valid({ verdict: 'rework', reworkSteps: ['again'] }));
      const third = await call(tool, valid({ verdict: 'rework', reworkSteps: ['once more'] }));
      expect(first.rejected || second.rejected || third.rejected).toBe(false);
      if (first.rejected || second.rejected || third.rejected) return;
      // approve with a 3 is overruled to rework; the third rework hits the limit.
      expect([first.row.verdict, first.row.decision, first.row.attempt]).toEqual([
        'approve',
        'rework',
        1,
      ]);
      expect([second.row.decision, second.row.attempt]).toEqual(['rework', 2]);
      expect([third.row.decision, third.row.attempt]).toEqual(['escalate', 3]);
      expect(JSON.parse(third.row.rework_steps)).toEqual(['once more']);
    });

    it('resolves a goal id prefix', async () => {
      const result = await call(tool, valid({ goalId: goalId.slice(0, 8) }));
      expect(result.rejected ? null : result.row.goal_id).toBe(goalId);
    });

    it('leaves ticket reviews alone', async () => {
      await call(tool, valid());
      expect(db.prepare('SELECT COUNT(*) AS n FROM pm_ticket_reviews').get()).toEqual({ n: 0 });
    });
  });

  describe('invalid scores', () => {
    it.each([
      ['below 1', { criteria_met: 0 }],
      ['above 5', { scope_respected: 6 }],
      ['not an integer', { solves_problem: 4.5 }],
      ['a string', { solution_quality: '4' }],
    ])('rejects a score %s', async (_label, bad) => {
      const payload = { ...valid(), scores: { ...valid().scores, ...bad } };
      expect((await call(tool, payload)).rejected).toBe(true);
      expect(() => submitGoalReview(db, payload as GoalReviewParams)).toThrow(
        /Invalid goal review: scores\./
      );
      expect(count()).toBe(0);
    });

    it('rejects a missing score and an extra one', async () => {
      const { scope_respected: _dropped, ...three } = valid().scores;
      expect((await call(tool, { ...valid(), scores: three })).rejected).toBe(true);
      expect(
        (await call(tool, { ...valid(), scores: { ...valid().scores, speed: 5 } })).rejected
      ).toBe(true);
      expect(count()).toBe(0);
    });
  });

  describe('missing reason', () => {
    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['whitespace', '   '],
    ])('rejects a reason that is %s', async (_label, reason) => {
      const payload = { ...valid(), reason };
      expect((await call(tool, payload)).rejected).toBe(true);
      expect(() => submitGoalReview(db, payload as GoalReviewParams)).toThrow(/reason/);
      expect(count()).toBe(0);
    });
  });

  describe('unknown goal', () => {
    it('rejects a goal that does not exist, through the tool and the function', async () => {
      await expect(
        call(tool, valid({ goalId: 'ffffffff-0000-0000-0000-000000000000' }))
      ).rejects.toThrow(/No goal found|Goal not found/);
      expect(() =>
        submitGoalReview(db, valid({ goalId: 'ffffffff-0000-0000-0000-000000000000' }))
      ).toThrow('Goal not found: ffffffff-0000-0000-0000-000000000000');
      expect(count()).toBe(0);
    });
  });

  describe('shape of the reviewer output', () => {
    it.each([
      ['unknown verdict', { verdict: 'pass' }],
      ['unknown criterion state', { criteria: [{ criterion: 'K', met: 'maybe', evidence: '' }] }],
      [
        'finding without scope',
        { findings: [{ severity: 'blocker', what: 'x', where: 'y', why: 'z' }] },
      ],
      [
        'unknown severity',
        { findings: [{ severity: 'fatal', what: 'x', where: 'y', why: 'z', scope: 'in_goal' }] },
      ],
      ['blank rework step', { reworkSteps: [' '] }],
    ])('rejects %s', async (_label, bad) => {
      expect((await call(tool, { ...valid(), ...bad })).rejected).toBe(true);
      expect(count()).toBe(0);
    });
  });
});

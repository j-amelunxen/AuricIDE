import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { createEpic } from '../tools/epics';
import { createGoal } from '../tools/goalsDb';
import { createTicket } from '../tools/tickets';
import { listAgentUsage, summarizeAgentUsage } from '../tools/agentUsage';

interface InsertUsage {
  id: string;
  ticketId?: string | null;
  goalId?: string | null;
  provider?: string;
  finishedAt?: string;
  costUsd?: number | null;
  inputTokens?: number;
}

function insertUsage(db: Database.Database, run: InsertUsage): void {
  db.prepare(
    `INSERT INTO pm_agent_usage (id, agent_id, ticket_id, goal_id, run_kind, run_source, provider,
       headless, started_at, finished_at, duration_ms, outcome, input_tokens, cost_usd, cost_source,
       unpriced_models)
     VALUES (?, 'agent', ?, ?, 'ticket', 'conductor', ?, 1, ?, ?, 1000, 'success', ?, ?, ?, ?)`
  ).run(
    run.id,
    run.ticketId ?? null,
    run.goalId ?? null,
    run.provider ?? 'claude',
    run.finishedAt ?? '2026-09-29T10:00:00Z',
    run.finishedAt ?? '2026-09-29T10:00:00Z',
    run.inputTokens ?? 0,
    run.costUsd === undefined ? 1 : run.costUsd,
    run.costUsd === null ? 'none' : 'cli',
    run.costUsd === null ? '["model-x"]' : null
  );
}

describe('agent usage MCP tools', () => {
  let db: Database.Database;
  let ticketId: string;
  let otherTicketId: string;
  let rootGoalId: string;
  let childGoalId: string;

  beforeEach(() => {
    db = createTestDb();
    const epicId = createEpic(db, { name: 'Epic' }).id;
    rootGoalId = createGoal(db, { name: 'Root' }, 'test').id;
    childGoalId = createGoal(db, { name: 'Child', parentId: rootGoalId }, 'test').id;
    ticketId = createTicket(db, { epicId, name: 'Linked ticket', goalId: childGoalId }).id;
    otherTicketId = createTicket(db, { epicId, name: 'Plain ticket' }).id;
  });

  afterEach(() => {
    db.close();
  });

  describe('listAgentUsage', () => {
    it('returns rows in the contract shape, newest first', () => {
      insertUsage(db, { id: 'old', ticketId, finishedAt: '2026-09-01T00:00:00Z', inputTokens: 5 });
      insertUsage(db, {
        id: 'new',
        ticketId,
        finishedAt: '2026-09-02T00:00:00Z',
        costUsd: null,
      });

      const rows = listAgentUsage(db, {});

      expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
      expect(rows[0]).toMatchObject({
        ticketId,
        headless: true,
        costUsd: null,
        costSource: 'none',
        unpricedModels: ['model-x'],
      });
      expect(rows[1]).toMatchObject({ costUsd: 1, inputTokens: 5, unpricedModels: null });
    });

    it('filters by ticket, resolving an id prefix', () => {
      insertUsage(db, { id: 'a', ticketId });
      insertUsage(db, { id: 'b', ticketId: otherTicketId });

      expect(listAgentUsage(db, { ticketId: ticketId.slice(0, 8) }).map((r) => r.id)).toEqual([
        'a',
      ]);
    });

    it('a goal filter covers the subtree: descendant goals and their tickets, each run once', () => {
      insertUsage(db, { id: 'on-root', goalId: rootGoalId });
      insertUsage(db, { id: 'on-child', goalId: childGoalId });
      insertUsage(db, { id: 'via-ticket', ticketId });
      insertUsage(db, { id: 'both', ticketId, goalId: childGoalId });
      insertUsage(db, { id: 'unrelated', ticketId: otherTicketId });

      const ids = listAgentUsage(db, { goalId: rootGoalId })
        .map((r) => r.id)
        .sort();

      expect(ids).toEqual(['both', 'on-child', 'on-root', 'via-ticket']);
    });

    it('a leaf goal does not include its parent’s runs', () => {
      insertUsage(db, { id: 'on-root', goalId: rootGoalId });
      insertUsage(db, { id: 'on-child', goalId: childGoalId });

      expect(listAgentUsage(db, { goalId: childGoalId }).map((r) => r.id)).toEqual(['on-child']);
    });

    it('since keeps only runs finished at or after it', () => {
      insertUsage(db, { id: 'old', ticketId, finishedAt: '2026-09-01T00:00:00Z' });
      insertUsage(db, { id: 'new', ticketId, finishedAt: '2026-09-20T00:00:00Z' });

      expect(listAgentUsage(db, { since: '2026-09-10T00:00:00Z' }).map((r) => r.id)).toEqual([
        'new',
      ]);
    });

    it('limit caps the list after filtering, newest kept', () => {
      insertUsage(db, { id: 'a', ticketId, finishedAt: '2026-09-01T00:00:00Z' });
      insertUsage(db, { id: 'b', ticketId, finishedAt: '2026-09-02T00:00:00Z' });
      insertUsage(db, { id: 'c', ticketId, finishedAt: '2026-09-03T00:00:00Z' });

      expect(listAgentUsage(db, { limit: 2 }).map((r) => r.id)).toEqual(['c', 'b']);
    });

    it('rejects an unknown ticket instead of returning an empty list', () => {
      expect(() => listAgentUsage(db, { ticketId: 'no-such-ticket-id' })).toThrow(/No ticket/);
    });
  });

  describe('summarizeAgentUsage', () => {
    it('groups by ticket with totals, and keeps unknown costs out of the sum but counted', () => {
      insertUsage(db, { id: 'a', ticketId, costUsd: 1.5, inputTokens: 10 });
      insertUsage(db, { id: 'b', ticketId, costUsd: null, inputTokens: 5 });
      insertUsage(db, { id: 'c', ticketId: otherTicketId, costUsd: 3 });

      const summary = summarizeAgentUsage(db, 'ticket');

      expect(summary.groupBy).toBe('ticket');
      expect(summary.groups.map((g) => [g.label, g.runs, g.costUsd, g.unknownCostRuns])).toEqual([
        ['Plain ticket', 1, 3, 0],
        ['Linked ticket', 2, 1.5, 1],
      ]);
      expect(summary.totals).toMatchObject({ runs: 3, costUsd: 4.5, unknownCostRuns: 1 });
    });

    it('groups by goal, through the ticket when the run names none', () => {
      insertUsage(db, { id: 'a', goalId: rootGoalId });
      insertUsage(db, { id: 'b', ticketId });

      const labels = summarizeAgentUsage(db, 'goal').groups.map((g) => [g.label, g.runs]);

      expect(labels).toEqual(
        expect.arrayContaining([
          ['Root', 1],
          ['Child', 1],
        ])
      );
    });

    it('groups by status using the ticket’s current status', () => {
      insertUsage(db, { id: 'a', ticketId });
      db.prepare("UPDATE pm_tickets SET status = 'done' WHERE id = ?").run(ticketId);

      expect(summarizeAgentUsage(db, 'status').groups.map((g) => g.label)).toEqual(['done']);
    });

    it('groups by provider', () => {
      insertUsage(db, { id: 'a', provider: 'claude', costUsd: 2 });
      insertUsage(db, { id: 'b', provider: 'codex', costUsd: 1 });

      expect(summarizeAgentUsage(db, 'provider').groups.map((g) => g.label)).toEqual([
        'claude',
        'codex',
      ]);
    });
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  listGoals,
  getGoal,
  getGoalTree,
  createGoal,
  updateGoal,
  deleteGoal,
  decomposeGoal,
  materializeGoalPlan,
  linkTicketToGoal,
  linkRequirementToGoal,
  recordGoalRun,
  completeGoalRun,
  listGoalRuns,
  evaluateGoal,
} from './goals';
import { createTestDb } from '../db';

function insertEpicAndTicket(db: Database.Database, ticketId = 't1', status = 'open'): void {
  db.prepare('INSERT OR IGNORE INTO pm_epics (id, name) VALUES (?, ?)').run('e1', 'Epic');
  db.prepare('INSERT INTO pm_tickets (id, epic_id, name, status) VALUES (?, ?, ?, ?)').run(
    ticketId,
    'e1',
    `Ticket ${ticketId}`,
    status
  );
}

function insertRequirement(db: Database.Database, id = 'r1', status = 'active'): void {
  db.prepare('INSERT INTO pm_requirements (id, req_id, title, status) VALUES (?, ?, ?, ?)').run(
    id,
    `REQ-${id.toUpperCase()}`,
    `Requirement ${id}`,
    status
  );
}

describe('goal MCP tools', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe('createGoal / getGoal / listGoals', () => {
    it('creates a goal with defaults and provenance', () => {
      const goal = createGoal(db, { name: 'Ship it' }, 'mcp');
      expect(goal.name).toBe('Ship it');
      expect(goal.status).toBe('draft');
      expect(goal.created_by).toBe('mcp');
      expect(getGoal(db, goal.id)?.id).toBe(goal.id);
    });

    it('creates a child goal under a parent', () => {
      const parent = createGoal(db, { name: 'Parent' }, 'mcp');
      const child = createGoal(db, { name: 'Child', parentId: parent.id }, 'mcp');
      expect(child.parent_id).toBe(parent.id);
    });

    it('rejects a child of a non-existent parent', () => {
      expect(() => createGoal(db, { name: 'Orphan', parentId: 'missing' }, 'mcp')).toThrow();
    });

    it('lists goals filtered by status and parent', () => {
      const p = createGoal(db, { name: 'P', status: 'active' }, 'mcp');
      createGoal(db, { name: 'C', parentId: p.id, status: 'draft' }, 'mcp');
      expect(listGoals(db, { status: 'active' })).toHaveLength(1);
      expect(listGoals(db, { parentId: p.id })).toHaveLength(1);
      expect(listGoals(db)).toHaveLength(2);
    });
  });

  describe('updateGoal / deleteGoal', () => {
    it('updates fields and bumps updated_at', () => {
      const goal = createGoal(db, { name: 'Old' }, 'mcp');
      const updated = updateGoal(db, goal.id, { name: 'New', status: 'active' });
      expect(updated.name).toBe('New');
      expect(updated.status).toBe('active');
    });

    it('achieving via update sets achieved_at automatically', () => {
      const goal = createGoal(db, { name: 'G' }, 'mcp');
      const updated = updateGoal(db, goal.id, { status: 'achieved' });
      expect(updated.achieved_at).not.toBeNull();
    });

    it('delete cascades to children via FK', () => {
      const p = createGoal(db, { name: 'P' }, 'mcp');
      const c = createGoal(db, { name: 'C', parentId: p.id }, 'mcp');
      expect(deleteGoal(db, p.id)).toBe(true);
      expect(getGoal(db, c.id)).toBeNull();
    });
  });

  describe('decomposeGoal', () => {
    it('creates multiple children in one transaction', () => {
      const p = createGoal(db, { name: 'P' }, 'mcp');
      const children = decomposeGoal(
        db,
        p.id,
        [{ name: 'A' }, { name: 'B', successCriteria: '- b done' }],
        'agent'
      );
      expect(children).toHaveLength(2);
      expect(children.every((c) => c.parent_id === p.id)).toBe(true);
      expect(children[1].success_criteria).toBe('- b done');
    });
  });

  describe('materializeGoalPlan', () => {
    it('atomically creates active child goals with one open ticket linked to each child', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Delivery');

      const pairs = materializeGoalPlan(
        db,
        parent.id,
        'epic-1',
        [
          {
            goal: {
              name: 'Authentication works',
              successCriteria: '- login test passes',
              priority: 'high',
            },
            ticket: { name: 'Implement authentication', description: 'Build the login flow' },
          },
          {
            goal: { name: 'Launch is approved' },
            ticket: { name: 'Approve launch', needsHumanSupervision: true },
          },
        ],
        'agent'
      );

      expect(pairs).toHaveLength(2);
      for (const { goal, ticket } of pairs) {
        expect(goal.parent_id).toBe(parent.id);
        expect(goal.status).toBe('active');
        expect(ticket.epic_id).toBe('epic-1');
        expect(ticket.status).toBe('open');
        expect(ticket.goal_id).toBe(goal.id);
        expect(ticket.goal_id).not.toBe(parent.id);
      }
      expect(pairs[1].ticket.needs_human_supervision).toBe(1);
    });

    it('returns the existing goal and ticket pair when the exact package is materialized again', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Delivery');
      const packages = [
        {
          goal: { name: 'Authentication works', description: 'First description' },
          ticket: { name: 'Implement authentication', description: 'First ticket description' },
        },
      ];

      const first = materializeGoalPlan(db, parent.id, 'epic-1', packages, 'agent');
      const second = materializeGoalPlan(db, parent.id, 'epic-1', packages, 'agent');

      expect(second).toEqual(first);
      expect(listGoals(db, { parentId: parent.id })).toHaveLength(1);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM pm_tickets').get() as { count: number }).count
      ).toBe(1);
    });

    it('reuses a matching linked ticket even when it belongs to another epic', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Original');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-2', 'Requested');
      const first = materializeGoalPlan(
        db,
        parent.id,
        'epic-1',
        [{ goal: { name: 'Child' }, ticket: { name: 'Work' } }],
        'agent'
      );

      const second = materializeGoalPlan(
        db,
        parent.id,
        'epic-2',
        [{ goal: { name: 'Child' }, ticket: { name: 'Work' } }],
        'agent'
      );

      expect(second[0].ticket.id).toBe(first[0].ticket.id);
      expect(second[0].ticket.epic_id).toBe('epic-1');
    });

    it('rejects duplicate child goal names in one request before writing anything', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Delivery');

      expect(() =>
        materializeGoalPlan(
          db,
          parent.id,
          'epic-1',
          [
            { goal: { name: 'Same child' }, ticket: { name: 'First work' } },
            { goal: { name: 'Same child' }, ticket: { name: 'Second work' } },
          ],
          'agent'
        )
      ).toThrow(/duplicate child goal name/i);

      expect(listGoals(db, { parentId: parent.id })).toEqual([]);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM pm_tickets').get() as { count: number }).count
      ).toBe(0);
    });

    it('rejects ambiguous existing direct children with the same exact name', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      createGoal(db, { name: 'Duplicate', parentId: parent.id }, 'ui');
      createGoal(db, { name: 'Duplicate', parentId: parent.id }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Delivery');

      expect(() =>
        materializeGoalPlan(
          db,
          parent.id,
          'epic-1',
          [{ goal: { name: 'Duplicate' }, ticket: { name: 'Work' } }],
          'agent'
        )
      ).toThrow(/ambiguous/i);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM pm_tickets').get() as { count: number }).count
      ).toBe(0);
    });

    it('rejects ambiguous same-named tickets linked to the matching child', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      const child = createGoal(db, { name: 'Child', parentId: parent.id }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Delivery');
      db.prepare(
        'INSERT INTO pm_tickets (id, epic_id, name, status, goal_id) VALUES (?, ?, ?, ?, ?)'
      ).run('ticket-a', 'epic-1', 'Work', 'open', child.id);
      db.prepare(
        'INSERT INTO pm_tickets (id, epic_id, name, status, goal_id) VALUES (?, ?, ?, ?, ?)'
      ).run('ticket-b', 'epic-1', 'Work', 'open', child.id);

      expect(() =>
        materializeGoalPlan(
          db,
          parent.id,
          'epic-1',
          [{ goal: { name: 'Child' }, ticket: { name: 'Work' } }],
          'agent'
        )
      ).toThrow(/ambiguous ticket name/i);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM pm_tickets').get() as { count: number }).count
      ).toBe(2);
    });

    it('rolls back the whole batch when a later package fails ticket validation', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');
      db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Delivery');

      expect(() =>
        materializeGoalPlan(
          db,
          parent.id,
          'epic-1',
          [
            { goal: { name: 'First child' }, ticket: { name: 'First work' } },
            {
              goal: { name: 'Second child' },
              ticket: { name: 'Second work', priority: 'invalid-priority' as 'normal' },
            },
          ],
          'agent'
        )
      ).toThrow(/priority/i);

      expect(listGoals(db, { parentId: parent.id })).toEqual([]);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM pm_tickets').get() as { count: number }).count
      ).toBe(0);
    });

    it('leaves no child goals or tickets behind when the epic does not exist', () => {
      const parent = createGoal(db, { name: 'Meta goal' }, 'ui');

      expect(() =>
        materializeGoalPlan(
          db,
          parent.id,
          'missing-epic',
          [{ goal: { name: 'Child' }, ticket: { name: 'Work' } }],
          'agent'
        )
      ).toThrow(/epic/i);

      expect(listGoals(db, { parentId: parent.id })).toEqual([]);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM pm_tickets').get() as { count: number }).count
      ).toBe(0);
    });
  });

  describe('goal tree', () => {
    it('returns nested tree with tickets summary', () => {
      const root = createGoal(db, { name: 'Root' }, 'mcp');
      const child = createGoal(db, { name: 'Child', parentId: root.id }, 'mcp');
      insertEpicAndTicket(db, 't1', 'done');
      linkTicketToGoal(db, 't1', child.id);

      const tree = getGoalTree(db);
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('Root');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].tickets).toEqual([
        expect.objectContaining({ id: 't1', status: 'done' }),
      ]);
    });
  });

  describe('linking', () => {
    it('links a ticket to a goal', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      insertEpicAndTicket(db);
      linkTicketToGoal(db, 't1', g.id);
      const row = db.prepare('SELECT goal_id FROM pm_tickets WHERE id = ?').get('t1') as {
        goal_id: string;
      };
      expect(row.goal_id).toBe(g.id);
    });

    it('links a requirement idempotently', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      insertRequirement(db);
      linkRequirementToGoal(db, g.id, 'r1');
      linkRequirementToGoal(db, g.id, 'r1');
      const count = db.prepare('SELECT COUNT(*) AS n FROM pm_goal_requirement_links').get() as {
        n: number;
      };
      expect(count.n).toBe(1);
    });
  });

  describe('goal runs', () => {
    it('records a run with the prompt artifact and flips goal to in_progress', () => {
      const g = createGoal(db, { name: 'G', status: 'active' }, 'mcp');
      const run = recordGoalRun(db, {
        goalId: g.id,
        agentId: 'agent-1',
        prompt: 'Full goal prompt',
        model: 'sonnet',
        provider: 'claude',
        source: 'conductor',
      });
      expect(run.prompt).toBe('Full goal prompt');
      expect(run.outcome).toBe('running');
      expect(getGoal(db, g.id)?.status).toBe('in_progress');
    });

    it('completes a run with outcome and summary', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      const run = recordGoalRun(db, { goalId: g.id, agentId: 'a', prompt: 'p' });
      const done = completeGoalRun(db, run.id, 'completed', 'shipped');
      expect(done.outcome).toBe('completed');
      expect(done.summary).toBe('shipped');
      expect(done.finished_at).not.toBeNull();
    });

    it('lists runs for a goal newest first', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      recordGoalRun(db, { goalId: g.id, agentId: 'a1', prompt: 'p1' });
      recordGoalRun(db, { goalId: g.id, agentId: 'a2', prompt: 'p2' });
      const runs = listGoalRuns(db, g.id);
      expect(runs).toHaveLength(2);
    });
  });

  describe('evaluateGoal', () => {
    it('reports satisfied for a fully green goal', () => {
      const g = createGoal(db, { name: 'G', status: 'in_progress' }, 'mcp');
      insertEpicAndTicket(db, 't1', 'done');
      linkTicketToGoal(db, 't1', g.id);
      insertRequirement(db, 'r1', 'verified');
      linkRequirementToGoal(db, g.id, 'r1');

      const result = evaluateGoal(db, g.id);
      expect(result.satisfied).toBe(true);
      expect(result.blockers).toEqual([]);
    });

    it('lists blockers for open tickets, unverified requirements, unachieved children', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      createGoal(db, { name: 'Child', parentId: g.id, status: 'active' }, 'mcp');
      insertEpicAndTicket(db, 't1', 'open');
      linkTicketToGoal(db, 't1', g.id);
      insertRequirement(db, 'r1', 'active');
      linkRequirementToGoal(db, g.id, 'r1');

      const result = evaluateGoal(db, g.id);
      expect(result.satisfied).toBe(false);
      expect(result.blockers).toHaveLength(3);
    });

    it('counts tickets on descendant goals too', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      const c = createGoal(db, { name: 'C', parentId: g.id, status: 'achieved' }, 'mcp');
      insertEpicAndTicket(db, 't1', 'in_progress');
      linkTicketToGoal(db, 't1', c.id);

      const result = evaluateGoal(db, g.id);
      expect(result.satisfied).toBe(false);
      expect(result.blockers.join(' ')).toContain('Ticket t1');
    });

    it('refuses vacuous satisfaction for a goal with nothing attached', () => {
      const g = createGoal(db, { name: 'Empty' }, 'mcp');
      const result = evaluateGoal(db, g.id);
      expect(result.satisfied).toBe(false);
      expect(result.blockers.join(' ')).toContain('Add work before running the conductor');
    });
  });
});

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
  addGoalDependency,
  removeGoalDependency,
  listGoalDependencies,
  goalDependsOnIds,
  goalBlockedByInfo,
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

    it('stores the work mode per goal, auto by default', () => {
      const goal = createGoal(db, { name: 'Research' }, 'mcp');
      expect(goal.work_mode).toBe('auto');
      const stations = createGoal(db, { name: 'Write', workMode: 'stations' }, 'mcp');
      expect(stations.work_mode).toBe('stations');
      expect(updateGoal(db, stations.id, { workMode: 'tickets' }).work_mode).toBe('tickets');
    });

    it('refuses a work mode it does not know', () => {
      expect(() => createGoal(db, { name: 'X', workMode: 'sideways' }, 'mcp')).toThrow(
        /work mode/i
      );
      const goal = createGoal(db, { name: 'Y' }, 'mcp');
      expect(() => updateGoal(db, goal.id, { workMode: 'sideways' })).toThrow(/work mode/i);
    });

    it('lets a root goal point at its mission folder, relative to the project', () => {
      const goal = createGoal(db, { name: 'Mission' }, 'mcp');
      expect(goal.mission_path).toBeNull();
      const pointed = createGoal(db, { name: 'Pointed', missionPath: './missions/sample/' }, 'mcp');
      expect(pointed.mission_path).toBe('missions/sample');
      expect(updateGoal(db, goal.id, { missionPath: 'missions/other' }).mission_path).toBe(
        'missions/other'
      );
    });

    it('clears the mission link with null or a blank value', () => {
      const goal = createGoal(db, { name: 'M', missionPath: 'missions/sample' }, 'mcp');
      expect(updateGoal(db, goal.id, { missionPath: null }).mission_path).toBeNull();
      updateGoal(db, goal.id, { missionPath: 'missions/sample' });
      expect(updateGoal(db, goal.id, { missionPath: '  ' }).mission_path).toBeNull();
    });

    it('leaves the mission link alone when an update does not mention it', () => {
      const goal = createGoal(db, { name: 'M', missionPath: 'missions/sample' }, 'mcp');
      expect(updateGoal(db, goal.id, { name: 'Renamed' }).mission_path).toBe('missions/sample');
    });

    it('refuses a mission path outside the project and writes nothing', () => {
      expect(() =>
        createGoal(db, { name: 'X', missionPath: '/abs/missions/sample' }, 'mcp')
      ).toThrow(/relative to the project/i);
      expect(listGoals(db)).toHaveLength(0);
      const goal = createGoal(db, { name: 'Y' }, 'mcp');
      expect(() => updateGoal(db, goal.id, { name: 'Z', missionPath: '../elsewhere' })).toThrow(
        /inside the project/i
      );
      expect(getGoal(db, goal.id)).toMatchObject({ name: 'Y', mission_path: null });
    });

    it('keeps the mission link on root goals only', () => {
      const root = createGoal(db, { name: 'Root', missionPath: 'missions/sample' }, 'mcp');
      expect(() =>
        createGoal(db, { name: 'Child', parentId: root.id, missionPath: 'missions/x' }, 'mcp')
      ).toThrow(/root goal/i);
      const child = createGoal(db, { name: 'Child', parentId: root.id }, 'mcp');
      expect(() => updateGoal(db, child.id, { missionPath: 'missions/x' })).toThrow(/root goal/i);
      // Moving a goal that carries a mission under a parent needs the link cleared too.
      const other = createGoal(db, { name: 'Other' }, 'mcp');
      expect(() => updateGoal(db, root.id, { parentId: other.id })).toThrow(/root goal/i);
      expect(getGoal(db, root.id)?.parent_id).toBeNull();
      const moved = updateGoal(db, root.id, { parentId: other.id, missionPath: null });
      expect(moved).toMatchObject({ parent_id: other.id, mission_path: null });
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

    it('holds a satisfied bundle member back until every member is satisfied', () => {
      const parent = createGoal(db, { name: 'Parent' }, 'mcp');
      const a = createGoal(
        db,
        { name: 'A', parentId: parent.id, status: 'active', bundle: 'AB' },
        'mcp'
      );
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', bundle: 'AB' },
        'mcp'
      );
      insertEpicAndTicket(db, 'ta', 'done');
      linkTicketToGoal(db, 'ta', a.id);
      insertEpicAndTicket(db, 'tb', 'open');
      linkTicketToGoal(db, 'tb', b.id);

      const resultA = evaluateGoal(db, a.id);
      expect(resultA.satisfied).toBe(false);
      expect(resultA.blockers).toEqual(['Bundle "AB": waiting for B']);

      const resultB = evaluateGoal(db, b.id);
      expect(resultB.satisfied).toBe(false);
      expect(resultB.blockers.join(' ')).toContain('Ticket tb');
    });

    it('reports a bundle member satisfied once every member is', () => {
      const parent = createGoal(db, { name: 'Parent' }, 'mcp');
      const a = createGoal(
        db,
        { name: 'A', parentId: parent.id, status: 'active', bundle: 'AB' },
        'mcp'
      );
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', bundle: 'AB' },
        'mcp'
      );
      insertEpicAndTicket(db, 'ta', 'done');
      linkTicketToGoal(db, 'ta', a.id);
      insertEpicAndTicket(db, 'tb', 'done');
      linkTicketToGoal(db, 'tb', b.id);

      expect(evaluateGoal(db, a.id).satisfied).toBe(true);
      expect(evaluateGoal(db, b.id).satisfied).toBe(true);
    });
  });

  describe('bundle and dependsOn on create/update', () => {
    it('normalizes a blank bundle to null', () => {
      const g = createGoal(db, { name: 'G', bundle: '  ' }, 'mcp');
      expect(g.bundle).toBeNull();
    });

    it('stores a trimmed bundle label', () => {
      const g = createGoal(db, { name: 'G', bundle: ' team-a ' }, 'mcp');
      expect(g.bundle).toBe('team-a');
    });

    it('clears a bundle on update with null', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const g = createGoal(db, { name: 'G', parentId: parent.id, bundle: 'x' }, 'mcp');
      const updated = updateGoal(db, g.id, { bundle: null });
      expect(updated.bundle).toBeNull();
    });

    it('resolves dependsOn by exact sibling name and blocks the goal', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', dependsOn: ['A'] },
        'mcp'
      );
      expect(goalDependsOnIds(db, b.id)).toEqual([a.id]);
      expect(goalBlockedByInfo(db, b.id)).toEqual([{ goalId: a.id, viaGoalId: b.id }]);
    });

    it('resolves dependsOn by goal id prefix', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', dependsOn: [a.id.slice(0, 8)] },
        'mcp'
      );
      expect(goalDependsOnIds(db, b.id)).toEqual([a.id]);
    });

    it('rejects an unknown dependsOn reference and creates nothing', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      expect(() =>
        createGoal(db, { name: 'B', parentId: parent.id, dependsOn: ['nope'] }, 'mcp')
      ).toThrow(/Unknown dependsOn reference 'nope'/);
      expect(listGoals(db, { parentId: parent.id })).toHaveLength(0);
    });

    it('rejects a dependsOn that would create a cycle and creates nothing', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', dependsOn: ['A'] },
        'mcp'
      );
      expect(() => addGoalDependency(db, a.id, b.id)).toThrow(/Cycle:/);
      expect(goalDependsOnIds(db, a.id)).toEqual([]);
    });
  });

  describe('decomposeGoal with mode/keys/bundle', () => {
    it('creates children after existing siblings with increasing sortOrder', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      createGoal(db, { name: 'Existing', parentId: parent.id }, 'mcp');
      const children = decomposeGoal(db, parent.id, [{ name: 'X' }, { name: 'Y' }], 'mcp');
      expect(children[0].sort_order).toBe(1);
      expect(children[1].sort_order).toBe(2);
    });

    it('chains children in listed order under serial mode', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const [a, b, c] = decomposeGoal(
        db,
        parent.id,
        [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
        'mcp',
        'serial'
      );
      expect(goalDependsOnIds(db, a.id)).toEqual([]);
      expect(goalDependsOnIds(db, b.id)).toEqual([a.id]);
      expect(goalDependsOnIds(db, c.id)).toEqual([b.id]);
    });

    it('resolves dependsOn by key within the same call, forward references included', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const [a, b] = decomposeGoal(
        db,
        parent.id,
        [
          { name: 'First', key: 'A', dependsOn: ['B'] },
          { name: 'Second', key: 'B' },
        ],
        'mcp'
      );
      expect(goalDependsOnIds(db, a.id)).toEqual([b.id]);
    });

    it('decomposes a parent into A -> [bundle B + C] -> D with waves [[A],[B,C],[D]]', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const [a, b, c, d] = decomposeGoal(
        db,
        parent.id,
        [
          { name: 'A', key: 'A' },
          { name: 'B', key: 'B', bundle: 'BC', dependsOn: ['A'] },
          { name: 'C', key: 'C', bundle: 'BC', dependsOn: ['A'] },
          { name: 'D', key: 'D', dependsOn: ['B', 'C'] },
        ],
        'mcp'
      );

      const result = listGoalDependencies(db, { parentId: parent.id });
      expect(result.waves).toEqual([[a.id], [b.id, c.id], [d.id]]);
      expect(result.bundles).toEqual([{ label: 'BC', memberIds: [b.id, c.id] }]);
      expect(result.blocked.map((x) => x.goalId).sort()).toEqual([b.id, c.id, d.id].sort());
    });
  });

  describe('add_goal_dependency / remove_goal_dependency / list_goal_dependencies', () => {
    it('adding the same edge twice is a no-op', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id }, 'mcp');
      const b = createGoal(db, { name: 'B', parentId: parent.id }, 'mcp');
      const first = addGoalDependency(db, b.id, a.id);
      const second = addGoalDependency(db, b.id, a.id);
      expect(second.id).toBe(first.id);
      expect(listGoalDependencies(db, { goalId: b.id }).edges).toHaveLength(1);
    });

    it('rejects a self-dependency', () => {
      const g = createGoal(db, { name: 'G' }, 'mcp');
      expect(() => addGoalDependency(db, g.id, g.id)).toThrow(/cannot depend on itself/);
    });

    it('removes an edge and it no longer blocks', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(db, { name: 'B', parentId: parent.id, status: 'active' }, 'mcp');
      addGoalDependency(db, b.id, a.id);
      expect(goalBlockedByInfo(db, b.id)).toHaveLength(1);

      const removed = removeGoalDependency(db, b.id, a.id);
      expect(removed.removed).toBe(true);
      expect(goalBlockedByInfo(db, b.id)).toHaveLength(0);
    });

    it('removing a non-existent edge reports removed: false', () => {
      const a = createGoal(db, { name: 'A' }, 'mcp');
      const b = createGoal(db, { name: 'B' }, 'mcp');
      expect(removeGoalDependency(db, b.id, a.id)).toEqual({ removed: false });
    });

    it('cascades edge deletion when a goal is deleted', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(db, { name: 'B', parentId: parent.id, status: 'active' }, 'mcp');
      addGoalDependency(db, b.id, a.id);

      deleteGoal(db, a.id);

      const row = db.prepare('SELECT COUNT(*) AS cnt FROM pm_goal_dependencies').get() as {
        cnt: number;
      };
      expect(row.cnt).toBe(0);
    });

    it('list_goal_dependencies with neither scope returns every edge and blocked goal', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(db, { name: 'B', parentId: parent.id, status: 'active' }, 'mcp');
      addGoalDependency(db, b.id, a.id);

      const result = listGoalDependencies(db, {});
      expect(result.edges).toHaveLength(1);
      expect(result.waves).toBeUndefined();
      expect(result.blocked).toEqual([
        { goalId: b.id, blockers: [{ goalId: a.id, viaGoalId: b.id }] },
      ]);
    });
  });

  describe('get_goal / get_goal_tree enrichment', () => {
    it('getGoalTree carries bundle, dependsOn and blockedBy on every node', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(
        db,
        { name: 'A', parentId: parent.id, status: 'active', bundle: 'x' },
        'mcp'
      );
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', dependsOn: ['A'] },
        'mcp'
      );

      const [tree] = getGoalTree(db, parent.id);
      const nodeA = tree.children.find((c) => c.id === a.id)!;
      const nodeB = tree.children.find((c) => c.id === b.id)!;
      expect(nodeA.bundle).toBe('x');
      expect(nodeB.dependsOn).toEqual([a.id]);
      expect(nodeB.blockedBy).toEqual([{ goalId: a.id, viaGoalId: b.id }]);
    });
  });

  describe('QA fix round: introduced-errors, achieve/bundle guard, name-before-prefix, sortOrder', () => {
    it('rejects update_goal bundle when it turns an existing edge same-bundle, and rolls back', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', dependsOn: ['A'] },
        'mcp'
      );
      updateGoal(db, a.id, { bundle: 'x' });

      expect(() => updateGoal(db, b.id, { bundle: 'x' })).toThrow(/same-bundle|same bundle/i);
      expect(getGoal(db, b.id)?.bundle).toBeNull();
    });

    it('rejects update_goal parentId when it turns an edge into a descendant violation, and rolls back', () => {
      const a = createGoal(db, { name: 'A' }, 'mcp');
      const b = createGoal(db, { name: 'B', dependsOn: ['A'] }, 'mcp');

      expect(() => updateGoal(db, a.id, { parentId: b.id })).toThrow(/descendant/);
      expect(getGoal(db, a.id)?.parent_id).toBeNull();
    });

    it('does not reject update_goal bundle/parentId for a pre-existing, unrelated violation', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(db, { name: 'B', parentId: parent.id, status: 'active' }, 'mcp');
      // Poison the table directly, bypassing validation (as an older build or
      // a hand edit might have).
      db.prepare(
        `INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id, created_at)
         VALUES (?, ?, ?, ?)`
      ).run('poisoned', a.id, a.id, new Date().toISOString());

      const c = createGoal(db, { name: 'C', parentId: parent.id, status: 'active' }, 'mcp');
      expect(() => updateGoal(db, c.id, { bundle: 'y' })).not.toThrow();
      expect(updateGoal(db, b.id, { parentId: parent.id }).parent_id).toBe(parent.id);
    });

    it('an old bad edge does not block a new, unrelated valid edge', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      db.prepare(
        `INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id, created_at)
         VALUES (?, ?, ?, ?)`
      ).run('poisoned', a.id, a.id, new Date().toISOString());

      const c = createGoal(db, { name: 'C', parentId: parent.id, status: 'active' }, 'mcp');
      expect(() =>
        createGoal(db, { name: 'D', parentId: parent.id, dependsOn: [c.id] }, 'mcp')
      ).not.toThrow();
    });

    it('rejects marking a bundle member achieved while a mate has not met its own conditions', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(
        db,
        { name: 'A', parentId: parent.id, status: 'active', bundle: 'x' },
        'mcp'
      );
      createGoal(db, { name: 'B', parentId: parent.id, status: 'active', bundle: 'x' }, 'mcp');

      expect(() => updateGoal(db, a.id, { status: 'achieved' })).toThrow(/waiting for B/);
      expect(getGoal(db, a.id)?.status).toBe('active');
    });

    it('allows marking a bundle member achieved once every mate is satisfied', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const a = createGoal(
        db,
        { name: 'A', parentId: parent.id, status: 'active', bundle: 'x' },
        'mcp'
      );
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', bundle: 'x' },
        'mcp'
      );
      insertEpicAndTicket(db, 'tb', 'done');
      linkTicketToGoal(db, 'tb', b.id);

      const updated = updateGoal(db, a.id, { status: 'achieved' });
      expect(updated.status).toBe('achieved');
    });

    it("resolves a dependsOn ref by exact sibling name even when it matches another goal's id prefix", () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      const other = createGoal(db, { name: 'elsewhere' }, 'mcp');
      const prefix = other.id.slice(0, 4);
      const sibling = createGoal(
        db,
        { name: prefix, parentId: parent.id, status: 'active' },
        'mcp'
      );

      const w = createGoal(
        db,
        { name: 'W', parentId: parent.id, status: 'active', dependsOn: [prefix] },
        'mcp'
      );
      expect(goalDependsOnIds(db, w.id)).toEqual([sibling.id]);
    });

    it('rejects an ambiguous sibling name for dependsOn', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      createGoal(db, { name: 'dup', parentId: parent.id, status: 'active' }, 'mcp');
      createGoal(db, { name: 'dup', parentId: parent.id, status: 'active' }, 'mcp');

      expect(() =>
        createGoal(db, { name: 'W', parentId: parent.id, dependsOn: ['dup'] }, 'mcp')
      ).toThrow(/Ambiguous dependsOn reference 'dup'/);
    });

    it('decompose sortOrder continues after the highest existing sortOrder, not the sibling count', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      createGoal(db, { name: 'old', parentId: parent.id, sortOrder: 5 }, 'mcp');

      const [n1] = decomposeGoal(db, parent.id, [{ name: 'n1' }], 'mcp');
      expect(n1.sort_order).toBe(6);
    });

    it('stamps an ISO created_at on inserted dependency edges (no SQL default)', () => {
      const parent = createGoal(db, { name: 'P' }, 'mcp');
      createGoal(db, { name: 'A', parentId: parent.id, status: 'active' }, 'mcp');
      const b = createGoal(
        db,
        { name: 'B', parentId: parent.id, status: 'active', dependsOn: ['A'] },
        'mcp'
      );
      const edge = listGoalDependencies(db, { goalId: b.id }).edges[0];
      expect(edge.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

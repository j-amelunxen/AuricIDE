import { describe, expect, it } from 'vitest';
import contractJson from '../../../../verification/contracts/goal-satisfaction-v1.json';
import type { PmGoal, PmGoalRequirementLink, PmGoalStation } from '../../tauri/goals';
import type { PmTicket } from '../../tauri/pm';
import type { PmRequirement } from '../../tauri/requirements';
import { createTestDb } from '../../../mcp/db';
import {
  createGoal,
  evaluateGoal,
  linkRequirementToGoal,
  linkTicketToGoal,
} from '../../../mcp/tools/goals';
import { getGoalSatisfaction } from './goalSatisfaction';

type BlockerCategory =
  | 'empty-goal'
  | 'ticket-not-done'
  | 'requirement-not-verified'
  | 'station-not-done'
  | 'station-unverified-evidence'
  | 'child-not-achieved';

interface ContractFixture {
  child?: { status: string };
  tickets?: Array<{ goal: 'root' | 'child'; status: string }>;
  requirements?: Array<{ status: string }>;
  stations?: Array<{ goal: 'root' | 'child'; status: string; evidenceKind: string }>;
}

interface ContractCase {
  id: string;
  fixture: ContractFixture;
  expect: { satisfied: boolean; blockerCategories: BlockerCategory[] };
}

interface GoalSatisfactionContract {
  version: string;
  cases: ContractCase[];
}

const contract = contractJson as GoalSatisfactionContract;
const ROOT_ID = 'root';
const CHILD_ID = 'child';

function blockerCategories(blockers: string[]): BlockerCategory[] {
  return blockers.map((blocker) => {
    if (blocker.startsWith('This goal has no attached tickets')) return 'empty-goal';
    if (blocker.startsWith('Ticket ')) return 'ticket-not-done';
    if (blocker.startsWith('Requirement ')) return 'requirement-not-verified';
    if (blocker.includes('unverified claim')) return 'station-unverified-evidence';
    if (blocker.startsWith('Station ')) return 'station-not-done';
    if (blocker.startsWith('Sub-goal ')) return 'child-not-achieved';
    throw new Error(`Uncategorised goal-satisfaction blocker: ${blocker}`);
  });
}

function frontendFixture(fixture: ContractFixture): {
  goals: PmGoal[];
  tickets: PmTicket[];
  requirements: PmRequirement[];
  links: PmGoalRequirementLink[];
  stations: PmGoalStation[];
} {
  const goals: PmGoal[] = [
    {
      id: ROOT_ID,
      parentId: null,
      name: 'Root',
      description: '',
      successCriteria: '',
      status: 'active',
      priority: 'normal',
      goalPrompt: '',
      createdBy: 'ui',
      achievedAt: null,
      sortOrder: 0,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    },
  ];
  if (fixture.child) {
    goals.push({
      ...goals[0],
      id: CHILD_ID,
      parentId: ROOT_ID,
      name: 'Child',
      status: fixture.child.status as PmGoal['status'],
    });
  }

  const tickets = (fixture.tickets ?? []).map((ticket, index): PmTicket => ({
    id: `ticket-${index}`,
    epicId: 'epic-1',
    goalId: ticket.goal === 'child' ? CHILD_ID : ROOT_ID,
    name: `Ticket ${index}`,
    description: '',
    status: ticket.status as PmTicket['status'],
    statusUpdatedAt: '2026-01-01 00:00:00',
    sortOrder: index,
    priority: 'normal',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  }));
  const requirements = (fixture.requirements ?? []).map((requirement, index): PmRequirement => ({
    id: `requirement-${index}`,
    reqId: `REQ-${index}`,
    title: `Requirement ${index}`,
    description: '',
    type: 'functional',
    category: '',
    priority: 'normal',
    status: requirement.status as PmRequirement['status'],
    rationale: '',
    acceptanceCriteria: '',
    source: '',
    lastVerifiedAt: null,
    appliesTo: [],
    sortOrder: index,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  }));
  const links = requirements.map((requirement, index): PmGoalRequirementLink => ({
    id: `link-${index}`,
    goalId: ROOT_ID,
    requirementId: requirement.id,
    createdAt: '2026-01-01 00:00:00',
  }));
  const stations = (fixture.stations ?? []).map((station, index): PmGoalStation => ({
    id: `station-${index}`,
    goalId: station.goal === 'child' ? CHILD_ID : ROOT_ID,
    name: `Station ${index}`,
    kind: 'normal',
    status: station.status as PmGoalStation['status'],
    evidenceKind: station.evidenceKind as PmGoalStation['evidenceKind'],
    predicate: { type: 'undefined' },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: index,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  }));

  return { goals, tickets, requirements, links, stations };
}

function evaluateInSqlite(fixture: ContractFixture): { satisfied: boolean; blockers: string[] } {
  const db = createTestDb();
  try {
    db.prepare('INSERT INTO pm_epics (id, name) VALUES (?, ?)').run('epic-1', 'Epic');
    const root = createGoal(db, { name: 'Root', status: 'active' }, 'contract');
    const goalIds = new Map([['root', root.id]]);
    if (fixture.child) {
      const child = createGoal(
        db,
        { name: 'Child', parentId: root.id, status: fixture.child.status },
        'contract'
      );
      goalIds.set('child', child.id);
    }

    for (const [index, ticket] of (fixture.tickets ?? []).entries()) {
      const id = `ticket-${index}`;
      db.prepare('INSERT INTO pm_tickets (id, epic_id, name, status) VALUES (?, ?, ?, ?)').run(
        id,
        'epic-1',
        `Ticket ${index}`,
        ticket.status
      );
      linkTicketToGoal(db, id, goalIds.get(ticket.goal)!);
    }
    for (const [index, requirement] of (fixture.requirements ?? []).entries()) {
      const id = `requirement-${index}`;
      db.prepare('INSERT INTO pm_requirements (id, req_id, title, status) VALUES (?, ?, ?, ?)').run(
        id,
        `REQ-${index}`,
        `Requirement ${index}`,
        requirement.status
      );
      linkRequirementToGoal(db, root.id, id);
    }
    for (const [index, station] of (fixture.stations ?? []).entries()) {
      db.prepare(
        `INSERT INTO pm_goal_stations (id, goal_id, name, kind, status, evidence_kind, predicate)
         VALUES (?, ?, ?, 'normal', ?, ?, '{"type":"undefined"}')`
      ).run(
        `station-${index}`,
        goalIds.get(station.goal)!,
        `Station ${index}`,
        station.status,
        station.evidenceKind
      );
    }

    return evaluateGoal(db, root.id);
  } finally {
    db.close();
  }
}

describe(`goal satisfaction contract ${contract.version}`, () => {
  it.each(contract.cases)(
    '$id has the specified frontend and SQLite outcome',
    ({ fixture, expect: expected }) => {
      const frontend = frontendFixture(fixture);
      const frontendResult = getGoalSatisfaction(
        frontend.goals,
        frontend.tickets,
        frontend.requirements,
        frontend.links,
        frontend.stations,
        ROOT_ID
      );
      const sqliteResult = evaluateInSqlite(fixture);

      expect(frontendResult.satisfied).toBe(expected.satisfied);
      expect(blockerCategories(frontendResult.blockers)).toEqual(expected.blockerCategories);
      expect(sqliteResult.satisfied).toBe(expected.satisfied);
      expect(blockerCategories(sqliteResult.blockers)).toEqual(expected.blockerCategories);
      expect({
        satisfied: sqliteResult.satisfied,
        blockerCategories: blockerCategories(sqliteResult.blockers),
      }).toEqual({
        satisfied: frontendResult.satisfied,
        blockerCategories: blockerCategories(frontendResult.blockers),
      });
    }
  );
});

/**
 * Conflict scenarios between the two writers of a project's goals: the UI
 * store (draft → `saveGoals` → Rust `goals_sync_impl`) and the MCP server
 * (field-level UPDATEs through `src/mcp/tools`). Both write one real SQLite
 * database here — only the Rust hop is replaced, by the port whose equality
 * with Rust `goalsSync.fixtures.json` checks on both sides.
 *
 * Every scenario asserts that nothing either side wrote goes missing. A write
 * counts as lost when a later save puts back a value its author never saw —
 * not when a person deliberately overwrites the same field afterwards (K13).
 * The case list and its MET-01 count live in
 * missions/goal-native/shared/artifacts/01-risiken-geklaert/konflikt-tests.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../mcp/db';
import {
  completeGoalRun,
  createGoal,
  deleteGoal,
  getGoal,
  recordGoalRun,
  updateGoal as mcpUpdateGoal,
} from '../../mcp/tools/goalsDb';
import {
  createStation,
  markStationDone,
  updateStation as mcpUpdateStation,
} from '../../mcp/tools/stations';
import { createGoalsSlice, type GoalsSlice } from './goalsSlice';
import { goalsLoadPort, goalsSyncPort, type GoalsSyncWire } from './goalsSyncPort.testing';

const PROJECT = '/projects/conflict';

let db: Database.Database;
/**
 * Runs once, right before the next `goals_load`: after a save's sync has
 * committed and before its own re-load reads the database back. That is the
 * window a person and an agent can both act in while a save is in flight.
 */
let beforeNextLoad: (() => void) | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'goals_load') {
      const hook = beforeNextLoad;
      beforeNextLoad = null;
      hook?.();
      return goalsLoadPort(db);
    }
    if (cmd === 'goals_save') return goalsSyncPort(db, args!.payload as GoalsSyncWire);
    throw new Error(`unexpected IPC in conflict test: ${cmd}`);
  }),
}));

vi.mock('../tauri/db', () => ({ initProjectDb: vi.fn(async () => undefined) }));

/** The station row exactly as it sits in the database. */
function getStation(database: Database.Database, id: string) {
  return database.prepare('SELECT * FROM pm_goal_stations WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
}

function createStore() {
  return create<GoalsSlice>()((...a) => ({ ...createGoalsSlice(...a) }));
}

type Store = ReturnType<typeof createStore>;

/** What the file watcher does when the MCP server touched project.db. */
const watcherReload = (store: Store) => store.getState().loadGoals(PROJECT);
const save = (store: Store) => store.getState().saveGoals(PROJECT);

describe('goal conflicts between UI saves and MCP writes (MET-01)', () => {
  let store: Store;
  let g1: string;
  let g2: string;

  beforeEach(async () => {
    db = createTestDb();
    g1 = createGoal(db, { name: 'First', status: 'active' }, 'mcp').id;
    g2 = createGoal(db, { name: 'Second', status: 'active' }, 'mcp').id;
    store = createStore();
    await store.getState().loadGoals(PROJECT);
  });

  afterEach(() => {
    beforeNextLoad = null;
    db.close();
  });

  describe('an MCP write followed by a UI save', () => {
    it('K01 keeps an MCP status change when the UI saves before its reload lands', async () => {
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await save(store); // a heartbeat/conductor save with nothing edited locally

      expect(getGoal(db, g1)!.status).toBe('in_progress');
    });

    it('K02 keeps an MCP status change the UI reloaded before editing', async () => {
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await watcherReload(store);
      store.getState().updateGoal(g1, { description: 'edited in the UI' });
      await save(store);

      expect(getGoal(db, g1)).toMatchObject({
        status: 'in_progress',
        description: 'edited in the UI',
      });
    });

    it('K03 keeps an MCP status change on the goal the UI is editing', async () => {
      store.getState().updateGoal(g1, { description: 'edited in the UI' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await watcherReload(store);
      await save(store);

      expect(getGoal(db, g1)).toMatchObject({
        status: 'in_progress',
        description: 'edited in the UI',
      });
    });

    it('K04 keeps an MCP status change while the UI edits a different goal', async () => {
      store.getState().updateGoal(g2, { description: 'edited in the UI' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await watcherReload(store);
      await save(store);

      expect(getGoal(db, g1)!.status).toBe('in_progress');
      expect(getGoal(db, g2)!.description).toBe('edited in the UI');
    });

    it('K05 keeps a station an agent marked done while the UI edits a goal', async () => {
      const s1 = createStation(db, { goalId: g1, name: 'Write tests' }).id;
      await watcherReload(store);
      store.getState().updateGoal(g2, { description: 'edited in the UI' });
      markStationDone(db, s1, 'tests at src/foo.test.ts');
      await watcherReload(store);
      await save(store);

      expect(getStation(db, s1)).toMatchObject({
        status: 'done',
        evidence_note: 'tests at src/foo.test.ts',
      });
    });

    it('K06 keeps a station an agent marked done when the evidence engine saves another', async () => {
      const s1 = createStation(db, { goalId: g1, name: 'Write tests' }).id;
      const s2 = createStation(db, { goalId: g1, name: 'Run build' }).id;
      await watcherReload(store);
      markStationDone(db, s1, 'tests at src/foo.test.ts');
      // checkStation: a predicate result lands on s2, then saveGoals, no reload between.
      store.getState().updateStation(s2, { evidenceNote: 'build not found' });
      await save(store);

      expect(getStation(db, s1)!.status).toBe('done');
      expect(getStation(db, s2)!.evidence_note).toBe('build not found');
    });

    it('K07 keeps the outcome an agent reported for its run', async () => {
      const run = recordGoalRun(db, { goalId: g1, agentId: 'agent-1', prompt: 'work g1' });
      await watcherReload(store);
      store.getState().updateGoal(g2, { description: 'edited in the UI' });
      completeGoalRun(db, run.id, 'success', 'all stations done');
      await watcherReload(store);
      await save(store);

      const row = db.prepare('SELECT outcome, summary FROM pm_goal_runs WHERE id = ?').get(run.id);
      expect(row).toEqual({ outcome: 'success', summary: 'all stations done' });
    });

    it('K08 does not bring back a goal an agent deleted', async () => {
      store.getState().updateGoal(g2, { description: 'edited in the UI' });
      deleteGoal(db, g1);
      await watcherReload(store);
      await save(store);

      expect(getGoal(db, g1)).toBeNull();
    });
  });

  describe('a UI change and an MCP write on the same rows', () => {
    it('K09 keeps a saved UI status when an agent later edits the goal', async () => {
      store.getState().updateGoal(g1, { status: 'archived' });
      await save(store);
      mcpUpdateGoal(db, g1, { description: 'agent notes' });

      expect(getGoal(db, g1)).toMatchObject({ status: 'archived', description: 'agent notes' });
    });

    it('K10 keeps both a pending UI status and an MCP description on one goal', async () => {
      store.getState().updateGoal(g1, { status: 'archived' });
      mcpUpdateGoal(db, g1, { description: 'agent notes' });
      await watcherReload(store);
      await save(store);

      expect(getGoal(db, g1)).toMatchObject({ status: 'archived', description: 'agent notes' });
    });

    it('K11 keeps a saved human tick when an agent later renames the station', async () => {
      const h = createStation(db, { goalId: g1, name: 'Call the customer', kind: 'human' }).id;
      await watcherReload(store);
      store.getState().tickHumanStation(h, 'called on Monday');
      await save(store);
      mcpUpdateStation(db, h, { name: 'Call the customer back' });

      expect(getStation(db, h)).toMatchObject({ status: 'done', name: 'Call the customer back' });
    });

    it('K12 keeps a pending human tick and an agent done-claim on another station', async () => {
      const h = createStation(db, { goalId: g1, name: 'Call the customer', kind: 'human' }).id;
      const s = createStation(db, { goalId: g1, name: 'Write tests' }).id;
      await watcherReload(store);
      store.getState().tickHumanStation(h, 'called on Monday');
      markStationDone(db, s, 'tests at src/foo.test.ts');
      await watcherReload(store);
      await save(store);

      expect(getStation(db, h)!.status).toBe('done');
      expect(getStation(db, s)!.status).toBe('done');
    });

    it('K14 keeps an MCP status change on the goal the UI saves before its reload lands', async () => {
      store.getState().updateGoal(g1, { description: 'edited in the UI' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' }); // inside the watcher's debounce window
      await save(store);

      expect(getGoal(db, g1)).toMatchObject({
        status: 'in_progress',
        description: 'edited in the UI',
      });
    });

    it('K15 keeps a done-claim on a station the evidence engine saves before its reload', async () => {
      const s = createStation(db, { goalId: g1, name: 'Write tests' }).id;
      await watcherReload(store);
      markStationDone(db, s, 'tests at src/foo.test.ts');
      // checkStation on the same station, from a draft that has not seen the claim
      store.getState().updateStation(s, { lastCheckedAt: '2026-09-27 00:00:00' });
      await save(store);

      expect(getStation(db, s)).toMatchObject({
        status: 'done',
        evidence_note: 'tests at src/foo.test.ts',
      });
    });

    it('K16 keeps an unseen MCP status the UI changed too, saving before its reload lands', async () => {
      store.getState().updateGoal(g1, { status: 'archived', description: 'edited in the UI' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' }); // inside the watcher's debounce window
      await save(store);

      expect(getGoal(db, g1)!.status).toBe('in_progress');
      // Nothing is lost on the UI side either: the edit waits for a decision.
      expect(store.getState().goalsDraft.find((g) => g.id === g1)).toMatchObject({
        status: 'archived',
        description: 'edited in the UI',
      });
      expect(store.getState().goalConflicts).toEqual([
        expect.objectContaining({ table: 'pm_goals', id: g1, columns: ['status'] }),
      ]);
    });

    it('K17 keeps an unseen MCP status the UI changed too, saving after a watcher reload', async () => {
      store.getState().updateGoal(g1, { status: 'archived' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await watcherReload(store); // the reload alone does not mean the person saw it
      await save(store);
      await save(store); // nor does a second save

      expect(getGoal(db, g1)!.status).toBe('in_progress');
      expect(store.getState().goalsDraft.find((g) => g.id === g1)!.status).toBe('archived');
      expect(store.getState().goalConflicts.map((c) => c.id)).toEqual([g1]);
    });

    it('K18 lets the person settle a conflict either way', async () => {
      store.getState().updateGoal(g1, { status: 'archived' });
      store.getState().updateGoal(g2, { status: 'archived' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      mcpUpdateGoal(db, g2, { status: 'in_progress' });
      await save(store);
      expect(store.getState().goalConflicts).toHaveLength(2);

      store.getState().resolveGoalConflict('pm_goals', g1, 'mine');
      store.getState().resolveGoalConflict('pm_goals', g2, 'theirs');
      await save(store);

      expect(getGoal(db, g1)!.status).toBe('archived');
      expect(getGoal(db, g2)!.status).toBe('in_progress');
      expect(store.getState().goalsDraft.find((g) => g.id === g2)!.status).toBe('in_progress');
      expect(store.getState().goalConflicts).toEqual([]);
    });

    it('K19 keeps an agent done-claim on a station the person ticked differently', async () => {
      const s = createStation(db, { goalId: g1, name: 'Write tests' }).id;
      await watcherReload(store);
      store.getState().updateStation(s, { status: 'fog' });
      markStationDone(db, s, 'tests at src/foo.test.ts');
      await save(store);

      expect(getStation(db, s)).toMatchObject({
        status: 'done',
        evidence_note: 'tests at src/foo.test.ts',
      });
      expect(store.getState().goalConflicts).toEqual([
        expect.objectContaining({ table: 'pm_goal_stations', id: s }),
      ]);
    });

    it('K20 keeps an unseen MCP status set while a save is in flight, against a UI edit made then', async () => {
      store.getState().updateGoal(g2, { description: 'something to save' });
      beforeNextLoad = () => {
        // between the save's sync and its re-load
        store.getState().updateGoal(g1, { status: 'archived' });
        mcpUpdateGoal(db, g1, { status: 'in_progress' });
      };
      await save(store);
      await save(store);
      await save(store);

      expect(getGoal(db, g1)!.status).toBe('in_progress');
      expect(store.getState().goalsDraft.find((g) => g.id === g1)!.status).toBe('archived');
      expect(store.getState().goalConflicts.map((c) => c.id)).toEqual([g1]);
    });

    it("K21 taking the agent's value keeps the person's other edits on that goal", async () => {
      store.getState().updateGoal(g1, { status: 'archived', description: 'edited in the UI' });
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await save(store);

      store.getState().resolveGoalConflict('pm_goals', g1, 'theirs');
      expect(store.getState().goalsDraft.find((g) => g.id === g1)).toMatchObject({
        status: 'in_progress',
        description: 'edited in the UI',
      });
      await save(store);

      expect(getGoal(db, g1)).toMatchObject({
        status: 'in_progress',
        description: 'edited in the UI',
      });
      expect(store.getState().goalConflicts).toEqual([]);
    });

    it("K22 taking the agent's done-claim keeps the person's rename of that station", async () => {
      const s = createStation(db, { goalId: g1, name: 'Write tests' }).id;
      await watcherReload(store);
      store.getState().updateStation(s, { status: 'fog', name: 'Write the tests' });
      markStationDone(db, s, 'tests at src/foo.test.ts');
      await save(store);

      store.getState().resolveGoalConflict('pm_goal_stations', s, 'theirs');
      await save(store);

      expect(getStation(db, s)).toMatchObject({
        status: 'done',
        evidence_note: 'tests at src/foo.test.ts',
        name: 'Write the tests',
      });
      expect(store.getState().goalConflicts).toEqual([]);
    });

    it('K13 lets a person deliberately overwrite a status they have seen', async () => {
      mcpUpdateGoal(db, g1, { status: 'in_progress' });
      await watcherReload(store);
      store.getState().updateGoal(g1, { status: 'active' });
      await save(store);

      expect(getGoal(db, g1)!.status).toBe('active');
    });
  });
});
